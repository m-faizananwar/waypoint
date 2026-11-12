import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { Proposal, TriageInput, TriageModel } from '../src/triage/proposal';
import { RulesTriageModel } from '../src/triage/rules.model';
import { TRIAGE_QUEUE } from '../src/triage/triage.queue';
import { TriageService } from '../src/triage/triage.service';
import { OidcFixture, otherKey } from './oidc-fixture';

/** Stands in for the LLM. "[llm-down]" in a title makes it fail, "[all-down]" makes every model fail. */
class FakeLlm implements TriageModel {
  readonly name = 'llm:fake';
  async propose({ title }: TriageInput): Promise<Proposal> {
    if (/\[(llm|all)-down\]/.test(title)) throw new Error('LLM unavailable');
    return { category: 'access', priority: 'HIGH', team: 'it-support', summary: title, confidence: 0.9, reasons: ['fake'] };
  }
}

class FlakyRules extends RulesTriageModel {
  async propose(input: TriageInput): Promise<Proposal> {
    if (input.title.includes('[all-down]')) throw new Error('rules failed too');
    return super.propose(input);
  }
}

describe('Requests API (e2e, real Postgres and Redis)', () => {
  const oidc = new OidcFixture();
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  const alice = () => oidc.token('alice', ['requester']);
  const dave = () => oidc.token('dave', ['requester']);
  const bob = () => oidc.token('bob', ['requester', 'approver']);
  const carol = () => oidc.token('carol', ['approver']);

  const submit = (token: string, body: object, key = randomUUID()) =>
    http.post('/requests').set('authorization', `Bearer ${token}`).set('idempotency-key', key).send(body);

  async function waitForStatus(id: string, status: string, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await prisma.request.findUnique({ where: { id } });
      if (row?.status === status) return row;
      if (Date.now() > deadline) throw new Error(`Request ${id} is ${row?.status}, expected ${status}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  beforeAll(async () => {
    await oidc.start();
    process.env.OIDC_ISSUER = oidc.issuer;
    process.env.OIDC_AUDIENCE = oidc.audience;
    process.env.OIDC_JWKS_URI = oidc.jwksUri;
    process.env.LLM_API_KEY = '';
    process.env.DATABASE_URL ??= 'postgresql://waypoint:waypoint@localhost:5432/waypoint';
    process.env.REDIS_URL ??= 'redis://localhost:6379';

    // Imported only now: ConfigModule.forRoot reads the environment when the module file loads.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TriageService)
      .useValue(new TriageService([new FakeLlm(), new FlakyRules()]))
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    await app.get<Queue>(getQueueToken(TRIAGE_QUEUE)).obliterate({ force: true });
    await prisma.auditEvent.deleteMany();
    await prisma.request.deleteMany();
  });

  afterAll(async () => {
    await app?.close();
    await oidc.stop();
  });

  describe('authentication', () => {
    it('serves health without a token', async () => {
      await http.get('/health').expect(200, { status: 'ok', database: 'up', redis: 'up' });
    });

    it('rejects a missing token', async () => {
      await http.get('/requests').expect(401);
    });

    it('rejects a token signed by a different key', async () => {
      const forged = oidc.token('alice', ['approver'], { key: otherKey() });
      await http.get('/requests').set('authorization', `Bearer ${forged}`).expect(401);
    });

    it('rejects a token for another audience', async () => {
      const wrongAud = oidc.token('alice', ['requester'], { audience: 'some-other-api' });
      await http.get('/requests').set('authorization', `Bearer ${wrongAud}`).expect(401);
    });

    it('rejects an expired token', async () => {
      const expired = oidc.token('alice', ['requester'], { expiresIn: -10 });
      await http.get('/requests').set('authorization', `Bearer ${expired}`).expect(401);
    });

    it('forbids submitting without the requester role', async () => {
      await submit(carol(), { title: 'Need access', body: 'Please' }).expect(403);
    });
  });

  describe('validation and idempotency', () => {
    it('requires an Idempotency-Key header', async () => {
      await http.post('/requests').set('authorization', `Bearer ${alice()}`).send({ title: 'abc', body: 'x' }).expect(400);
    });

    it('rejects unknown fields so clients cannot set status or proposal', async () => {
      await submit(alice(), { title: 'Laptop broken', body: 'Screen cracked', status: 'APPROVED' }).expect(400);
    });

    it('replays the same request for a repeated key and refuses a different body', async () => {
      const key = randomUUID();
      const body = { title: 'Monitor flickers', body: 'Second monitor flickers all day' };
      const first = await submit(alice(), body, key).expect(201);
      const replay = await submit(alice(), body, key).expect(200);
      expect(replay.body.id).toBe(first.body.id);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      await submit(alice(), { ...body, body: 'Something else' }, key).expect(409);
      expect(await prisma.request.count({ where: { idempotencyKey: key } })).toBe(1);
    });

    it('creates exactly one row when the same key arrives concurrently', async () => {
      const key = randomUUID();
      const body = { title: 'Keyboard missing keys', body: 'The E key fell off' };
      const results = await Promise.all(Array.from({ length: 5 }, () => submit(alice(), body, key)));
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    });
  });

  describe('triage, approval and audit', () => {
    it('triages in the background and waits for a human, without applying anything', async () => {
      const { body } = await submit(alice(), { title: 'Locked out of SSO', body: 'MFA reset needed' }).expect(201);
      const row = await waitForStatus(body.id, 'AWAITING_APPROVAL');
      expect(row.proposalModel).toBe('llm:fake');
      expect(row.needsReview).toBe(false);
      expect(row.category).toBeNull();
      expect(row.priority).toBeNull();
    });

    it('falls back to the rules model when the LLM is down and flags it for review', async () => {
      const { body } = await submit(alice(), { title: '[llm-down] Password expired', body: 'Cannot log in' }).expect(201);
      const row = await waitForStatus(body.id, 'AWAITING_APPROVAL');
      expect(row.proposalModel).toBe('rules-v1');
      expect(row.needsReview).toBe(true);
      expect((row.proposal as any).category).toBe('access');
    });

    it('enforces who may decide, then applies the proposal with overrides and records it all', async () => {
      const { body } = await submit(alice(), { title: 'Need VPN access', body: 'Starting on the platform team' }).expect(201);
      await waitForStatus(body.id, 'AWAITING_APPROVAL');

      // A requester cannot approve, and cannot even see someone else's request.
      await http.post(`/requests/${body.id}/approve`).set('authorization', `Bearer ${alice()}`).send({}).expect(403);
      await http.get(`/requests/${body.id}`).set('authorization', `Bearer ${dave()}`).expect(404);

      const approved = await http
        .post(`/requests/${body.id}/approve`)
        .set('authorization', `Bearer ${bob()}`)
        .send({ priority: 'MEDIUM', note: 'Not urgent, starts next week' })
        .expect(200);

      expect(approved.body).toMatchObject({
        status: 'APPROVED',
        category: 'access',
        team: 'it-support',
        priority: 'MEDIUM',
        decidedBy: 'bob',
      });
      expect(approved.body.events.map((e: any) => e.action)).toEqual(['submitted', 'triage_started', 'triaged', 'approved']);
      expect(approved.body.events.at(-1).data).toMatchObject({ overridden: ['priority'], proposalModel: 'llm:fake' });

      await http.post(`/requests/${body.id}/reject`).set('authorization', `Bearer ${carol()}`).send({ note: 'Too late' }).expect(409);
    });

    it('does not let an approver decide on their own request', async () => {
      const { body } = await submit(bob(), { title: 'New headset', body: 'Mine broke' }).expect(201);
      await waitForStatus(body.id, 'AWAITING_APPROVAL');
      await http.post(`/requests/${body.id}/approve`).set('authorization', `Bearer ${bob()}`).send({}).expect(403);
    });

    it('lets exactly one of two simultaneous decisions win', async () => {
      const { body } = await submit(alice(), { title: 'Refund duplicate invoice', body: 'Charged twice' }).expect(201);
      await waitForStatus(body.id, 'AWAITING_APPROVAL');
      const [a, b] = await Promise.all([
        http.post(`/requests/${body.id}/approve`).set('authorization', `Bearer ${bob()}`).send({}),
        http.post(`/requests/${body.id}/reject`).set('authorization', `Bearer ${carol()}`).send({ note: 'Duplicate' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const decisions = await prisma.auditEvent.count({
        where: { requestId: body.id, action: { in: ['approved', 'rejected'] } },
      });
      expect(decisions).toBe(1);
    });

    it('marks a request TRIAGE_FAILED after every retry fails, and an approver can re-queue it', async () => {
      const { body } = await submit(alice(), { title: '[all-down] Printer jam', body: 'Third floor' }).expect(201);
      await waitForStatus(body.id, 'TRIAGE_FAILED', 25000);
      const events = await prisma.auditEvent.findMany({ where: { requestId: body.id }, orderBy: { createdAt: 'asc' } });
      expect(events.filter((e) => e.action === 'triage_started')).toHaveLength(3);
      expect(events.at(-1)?.action).toBe('triage_failed');

      await http.post(`/requests/${body.id}/retriage`).set('authorization', `Bearer ${carol()}`).expect(202);
    }, 40000);
  });

  describe('listing', () => {
    it('shows requesters only their own requests and approvers everything', async () => {
      await submit(dave(), { title: 'Expense question', body: 'How do I claim travel?' }).expect(201);
      const mine = await http.get('/requests?limit=100').set('authorization', `Bearer ${dave()}`).expect(200);
      expect(mine.body.items.every((r: any) => r.requesterId === 'dave')).toBe(true);

      const all = await http.get('/requests?limit=100').set('authorization', `Bearer ${carol()}`).expect(200);
      expect(new Set(all.body.items.map((r: any) => r.requesterId))).toEqual(new Set(['alice', 'bob', 'dave']));
    });

    it('validates query parameters', async () => {
      await http.get('/requests?limit=1000').set('authorization', `Bearer ${carol()}`).expect(400);
    });
  });
});

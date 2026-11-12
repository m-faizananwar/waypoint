import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Request, RequestStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { audit } from '../audit/audit';
import { AuthUser } from '../auth/user';
import { PrismaService } from '../prisma/prisma.service';
import { Proposal } from '../triage/proposal';
import { TRIAGE_JOB_OPTIONS, TRIAGE_QUEUE, TriageJob } from '../triage/triage.queue';
import { CreateRequestDto } from './dto/create-request.dto';
import { ApproveRequestDto, RejectRequestDto } from './dto/decision.dto';
import { ListRequestsDto } from './dto/list-requests.dto';

export interface CreateResult {
  request: Request;
  created: boolean;
}

const isApprover = (user: AuthUser) => user.roles.includes('approver');

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TRIAGE_QUEUE) private readonly queue: Queue<TriageJob>,
  ) {}

  /**
   * Creates a request once per (requester, Idempotency-Key). A retry with the
   * same key and body returns the original. The same key with a different body
   * is a client bug and gets a 409 rather than a silent overwrite.
   */
  async create(user: AuthUser, dto: CreateRequestDto, idempotencyKey: string): Promise<CreateResult> {
    const existing = await this.findByKey(user.id, idempotencyKey);
    if (existing) return { request: this.assertSamePayload(existing, dto), created: false };

    let request: Request;
    try {
      request = await this.prisma.$transaction(async (tx) => {
        const created = await tx.request.create({
          data: {
            title: dto.title,
            body: dto.body,
            requesterId: user.id,
            requesterEmail: user.email,
            idempotencyKey,
          },
        });
        await audit(tx, created.id, user.id, 'submitted');
        return created;
      });
    } catch (err) {
      // Two concurrent calls with the same key: the loser reads the winner's row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findByKey(user.id, idempotencyKey);
        if (winner) return { request: this.assertSamePayload(winner, dto), created: false };
      }
      throw err;
    }

    await this.enqueue(request.id);
    return { request, created: true };
  }

  async list(user: AuthUser, query: ListRequestsDto) {
    const where: Prisma.RequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(isApprover(user) ? {} : { requesterId: user.id }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.request.findMany({ where, orderBy: { createdAt: 'desc' }, take: query.limit, skip: query.offset }),
      this.prisma.request.count({ where }),
    ]);
    return { items, total, limit: query.limit, offset: query.offset };
  }

  /** Requesters only see their own requests. Others get a 404, so ids can't be probed. */
  async get(user: AuthUser, id: string) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!request || (!isApprover(user) && request.requesterId !== user.id)) {
      throw new NotFoundException('Request not found');
    }
    return request;
  }

  /**
   * Applies the AI proposal, with any approver overrides, in one conditional
   * update. If two approvers act at once, only one transition wins and the
   * other gets a 409. Nobody approves their own request.
   */
  async approve(user: AuthUser, id: string, dto: ApproveRequestDto) {
    const request = await this.getForDecision(user, id);
    const proposal = request.proposal as Proposal | null;
    if (!proposal) throw new ConflictException('Request has no proposal to approve');

    const applied = {
      category: dto.category ?? proposal.category,
      priority: dto.priority ?? proposal.priority,
      team: dto.team ?? proposal.team,
    };
    const overridden = (Object.keys(applied) as (keyof typeof applied)[]).filter(
      (k) => dto[k] !== undefined && dto[k] !== proposal[k],
    );

    return this.decide(user, id, RequestStatus.APPROVED, { ...applied, decisionNote: dto.note }, 'approved', {
      applied,
      overridden,
      proposalModel: request.proposalModel,
      note: dto.note ?? null,
    });
  }

  async reject(user: AuthUser, id: string, dto: RejectRequestDto) {
    await this.getForDecision(user, id);
    return this.decide(user, id, RequestStatus.REJECTED, { decisionNote: dto.note }, 'rejected', { note: dto.note });
  }

  /** Puts a stuck or failed request back on the queue. */
  async retriage(user: AuthUser, id: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.request.updateMany({
        where: { id, status: { in: [RequestStatus.SUBMITTED, RequestStatus.TRIAGE_FAILED] } },
        data: { status: RequestStatus.SUBMITTED },
      });
      if (count === 1) await audit(tx, id, user.id, 'retriage_requested');
      return count;
    });
    if (result === 0) {
      const current = await this.prisma.request.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Request not found');
      throw new ConflictException(`Request is ${current.status} and cannot be re-triaged`);
    }
    await this.enqueue(id, true);
    return this.get(user, id);
  }

  private async decide(
    user: AuthUser,
    id: string,
    to: RequestStatus,
    data: Prisma.RequestUpdateManyMutationInput,
    action: 'approved' | 'rejected',
    auditData: Prisma.InputJsonValue,
  ) {
    const won = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.request.updateMany({
        where: { id, status: RequestStatus.AWAITING_APPROVAL },
        data: { ...data, status: to, decidedBy: user.id, decidedAt: new Date() },
      });
      if (count === 1) await audit(tx, id, user.id, action, auditData);
      return count === 1;
    });
    if (!won) {
      const current = await this.prisma.request.findUniqueOrThrow({ where: { id } });
      throw new ConflictException(`Request is already ${current.status}`);
    }
    return this.get(user, id);
  }

  private async getForDecision(user: AuthUser, id: string) {
    const request = await this.prisma.request.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');
    if (request.requesterId === user.id) {
      throw new ForbiddenException('You cannot decide on your own request');
    }
    if (request.status !== RequestStatus.AWAITING_APPROVAL) {
      throw new ConflictException(`Request is ${request.status}, not awaiting approval`);
    }
    return request;
  }

  private findByKey(requesterId: string, idempotencyKey: string) {
    return this.prisma.request.findUnique({
      where: { requesterId_idempotencyKey: { requesterId, idempotencyKey } },
    });
  }

  private assertSamePayload(existing: Request, dto: CreateRequestDto): Request {
    if (existing.title !== dto.title || existing.body !== dto.body) {
      throw new ConflictException('Idempotency-Key was already used with a different request body');
    }
    return existing;
  }

  /**
   * The job id is the request id, so a duplicate enqueue is a no-op in BullMQ.
   * A re-triage uses a fresh id because the old job may still be kept as failed.
   * If Redis is down the request stays SUBMITTED and can be re-triaged later.
   */
  private async enqueue(requestId: string, retry = false) {
    try {
      await this.queue.add('triage', { requestId }, {
        ...TRIAGE_JOB_OPTIONS,
        jobId: retry ? `${requestId}-${Date.now()}` : requestId,
      });
    } catch (err) {
      this.logger.error(`Could not enqueue triage for ${requestId}: ${(err as Error).message}`);
    }
  }
}

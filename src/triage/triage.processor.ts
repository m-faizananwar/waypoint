import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RequestStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { audit, SYSTEM_ACTOR } from '../audit/audit';
import { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { TRIAGE_QUEUE, TriageJob } from './triage.queue';
import { TriageService } from './triage.service';

/**
 * Background worker. Claims a request with a conditional update so two workers
 * can never triage the same request, asks the triage service for a proposal,
 * and parks the request for a human decision. It never applies the proposal.
 */
@Processor(TRIAGE_QUEUE, { concurrency: 5 })
export class TriageProcessor extends WorkerHost {
  private readonly logger = new Logger(TriageProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly triageService: TriageService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async process(job: Job<TriageJob>): Promise<{ status: string; model?: string }> {
    const { requestId } = job.data;

    const claimed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.request.updateMany({
        where: { id: requestId, status: { in: [RequestStatus.SUBMITTED, RequestStatus.TRIAGE_FAILED] } },
        data: { status: RequestStatus.TRIAGING },
      });
      if (count === 1) await audit(tx, requestId, SYSTEM_ACTOR, 'triage_started', { attempt: job.attemptsMade + 1 });
      return count === 1;
    });

    if (!claimed) {
      const current = await this.prisma.request.findUnique({ where: { id: requestId } });
      // A retry after a crash mid-triage finds the request still TRIAGING and carries on.
      if (current?.status !== RequestStatus.TRIAGING) {
        return { status: `skipped:${current?.status ?? 'missing'}` };
      }
      await this.prisma.$transaction((tx) =>
        audit(tx, requestId, SYSTEM_ACTOR, 'triage_started', { attempt: job.attemptsMade + 1, resumed: true }),
      );
    }

    const request = await this.prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    const { proposal, model } = await this.triageService.triage({ title: request.title, body: request.body });
    const needsReview = proposal.confidence < this.config.get('TRIAGE_MIN_CONFIDENCE', { infer: true });

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.request.updateMany({
        where: { id: requestId, status: RequestStatus.TRIAGING },
        data: {
          status: RequestStatus.AWAITING_APPROVAL,
          proposal: proposal as unknown as Prisma.InputJsonValue,
          proposalModel: model,
          needsReview,
        },
      });
      if (count === 1) {
        await audit(tx, requestId, SYSTEM_ACTOR, 'triaged', { model, confidence: proposal.confidence, needsReview });
      }
    });

    return { status: 'triaged', model };
  }

  /** After the last retry, mark the request so an approver can see it and re-triage it. */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<TriageJob> | undefined, error: Error) {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;
    this.logger.error(`Triage gave up on ${job.data.requestId} after ${job.attemptsMade} attempts: ${error.message}`);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.request.updateMany({
        where: { id: job.data.requestId, status: { in: [RequestStatus.SUBMITTED, RequestStatus.TRIAGING] } },
        data: { status: RequestStatus.TRIAGE_FAILED },
      });
      if (count === 1) {
        await audit(tx, job.data.requestId, SYSTEM_ACTOR, 'triage_failed', { error: error.message.slice(0, 500) });
      }
    });
  }
}

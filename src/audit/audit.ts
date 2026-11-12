import { Prisma } from '@prisma/client';

export type AuditAction =
  | 'submitted'
  | 'triage_started'
  | 'triaged'
  | 'triage_failed'
  | 'retriage_requested'
  | 'approved'
  | 'rejected';

/** Writes an audit event inside the caller's transaction, so state and history can't disagree. */
export function audit(
  tx: Prisma.TransactionClient,
  requestId: string,
  actor: string,
  action: AuditAction,
  data?: Prisma.InputJsonValue,
) {
  return tx.auditEvent.create({ data: { requestId, actor, action, data } });
}

export const SYSTEM_ACTOR = 'system:triage-worker';

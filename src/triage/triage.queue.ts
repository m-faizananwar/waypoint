export const TRIAGE_QUEUE = 'triage';

export interface TriageJob {
  requestId: string;
}

export const TRIAGE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

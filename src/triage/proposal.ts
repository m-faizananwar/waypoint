import { z } from 'zod';

export const CATEGORIES = ['access', 'hardware', 'software', 'billing', 'hr', 'other'] as const;
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const TEAMS = ['it-support', 'platform', 'finance', 'people-ops', 'service-desk'] as const;

/**
 * The only shape a model is allowed to hand back. Anything else is rejected,
 * so a model can never set a field or a value the API does not know about.
 */
export const proposalSchema = z
  .object({
    category: z.enum(CATEGORIES),
    priority: z.enum(PRIORITIES),
    team: z.enum(TEAMS),
    summary: z.string().trim().min(1).max(280),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
  })
  .strict();

export type Proposal = z.infer<typeof proposalSchema>;

export interface TriageInput {
  title: string;
  body: string;
}

export interface TriageResult {
  proposal: Proposal;
  model: string;
}

/** A model that turns a request into a proposal. Implementations must not throw for bad model output. */
export interface TriageModel {
  readonly name: string;
  propose(input: TriageInput): Promise<Proposal>;
}

/** Parses untrusted model text into a Proposal, or returns the validation problem in readable form. */
export function parseProposal(text: string): { ok: true; value: Proposal } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(text));
  } catch {
    return { ok: false, error: 'Response was not valid JSON.' };
  }
  const result = proposalSchema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
  };
}

function stripFences(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : text.trim();
}

import { Proposal, TriageInput, TriageModel } from './proposal';

type Rule = { match: RegExp; category: Proposal['category']; team: Proposal['team'] };

const RULES: Rule[] = [
  { match: /\b(password|login|log in|sign[- ]?in|access|permission|account locked|mfa|2fa|sso)\b/i, category: 'access', team: 'it-support' },
  { match: /\b(laptop|monitor|keyboard|mouse|printer|hardware|headset|phone|charger)\b/i, category: 'hardware', team: 'service-desk' },
  { match: /\b(invoice|payment|refund|billing|charge|expense|reimburse)\b/i, category: 'billing', team: 'finance' },
  { match: /\b(leave|holiday|payroll|contract|onboarding|offboarding|benefits)\b/i, category: 'hr', team: 'people-ops' },
  { match: /\b(deploy|server|database|outage|error|bug|crash|api|install|license|software|app)\b/i, category: 'software', team: 'platform' },
];

const URGENT = /\b(outage|down|production|cannot work|can't work|security|breach|data loss)\b/i;
const HIGH = /\b(urgent|asap|blocked|today|deadline)\b/i;

/**
 * Deterministic fallback used when no LLM is configured or the LLM fails.
 * Deliberately conservative: low confidence, so approvers look twice.
 */
export class RulesTriageModel implements TriageModel {
  readonly name = 'rules-v1';

  async propose({ title, body }: TriageInput): Promise<Proposal> {
    const text = `${title}\n${body}`;
    const rule = RULES.find((r) => r.match.test(text));
    const priority: Proposal['priority'] = URGENT.test(text) ? 'URGENT' : HIGH.test(text) ? 'HIGH' : 'MEDIUM';
    const reasons = [
      rule ? `Matched keywords for ${rule.category}` : 'No keyword rule matched',
      priority === 'MEDIUM' ? 'No urgency words found' : `Urgency words found, set to ${priority}`,
    ];
    return {
      category: rule?.category ?? 'other',
      team: rule?.team ?? 'service-desk',
      priority,
      summary: title.trim().slice(0, 280),
      confidence: rule ? 0.5 : 0.2,
      reasons,
    };
  }
}

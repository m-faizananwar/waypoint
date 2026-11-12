import { Proposal, TriageModel } from './proposal';
import { RulesTriageModel } from './rules.model';
import { TriageService } from './triage.service';

const failing: TriageModel = {
  name: 'llm:down',
  propose: async () => {
    throw new Error('timeout');
  },
};

const fixed = (p: Partial<Proposal>): TriageModel => ({
  name: 'llm:fake',
  propose: async () => ({
    category: 'hr',
    priority: 'LOW',
    team: 'people-ops',
    summary: 's',
    confidence: 0.9,
    reasons: ['r'],
    ...p,
  }),
});

describe('TriageService', () => {
  const input = { title: 'Password reset', body: 'Locked out' };

  it('uses the first model that answers and records which one it was', async () => {
    const result = await new TriageService([fixed({}), new RulesTriageModel()]).triage(input);
    expect(result.model).toBe('llm:fake');
  });

  it('falls back to the rules model when the LLM fails', async () => {
    const result = await new TriageService([failing, new RulesTriageModel()]).triage(input);
    expect(result.model).toBe('rules-v1');
    expect(result.proposal.category).toBe('access');
  });

  it('throws when every model fails', async () => {
    await expect(new TriageService([failing]).triage(input)).rejects.toThrow('timeout');
  });
});

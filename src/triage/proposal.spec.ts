import { parseProposal } from './proposal';

const valid = {
  category: 'access',
  priority: 'HIGH',
  team: 'it-support',
  summary: 'User locked out of SSO',
  confidence: 0.82,
  reasons: ['Mentions a locked account'],
};

describe('parseProposal', () => {
  it('accepts a valid proposal', () => {
    expect(parseProposal(JSON.stringify(valid))).toEqual({ ok: true, value: valid });
  });

  it('accepts JSON wrapped in a markdown fence', () => {
    expect(parseProposal('```json\n' + JSON.stringify(valid) + '\n```').ok).toBe(true);
  });

  it('rejects text that is not JSON', () => {
    expect(parseProposal('Sure! Here is the triage.')).toEqual({ ok: false, error: 'Response was not valid JSON.' });
  });

  it('rejects values outside the allowed sets', () => {
    const result = parseProposal(JSON.stringify({ ...valid, team: 'security' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('team');
  });

  it('rejects extra keys, so a model cannot set fields the API does not expose', () => {
    const result = parseProposal(JSON.stringify({ ...valid, status: 'APPROVED' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a confidence outside 0 to 1', () => {
    expect(parseProposal(JSON.stringify({ ...valid, confidence: 1.4 })).ok).toBe(false);
  });
});

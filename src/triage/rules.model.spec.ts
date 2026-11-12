import { RulesTriageModel } from './rules.model';

describe('RulesTriageModel', () => {
  const model = new RulesTriageModel();

  it('routes access problems to IT support', async () => {
    const p = await model.propose({ title: 'Cannot log in', body: 'My password expired' });
    expect(p).toMatchObject({ category: 'access', team: 'it-support', priority: 'MEDIUM' });
  });

  it('marks outages as urgent', async () => {
    const p = await model.propose({ title: 'API outage', body: 'Production is down for all customers' });
    expect(p).toMatchObject({ category: 'software', priority: 'URGENT' });
  });

  it('falls back to other with low confidence when nothing matches', async () => {
    const p = await model.propose({ title: 'Question', body: 'Where is the kitchen?' });
    expect(p).toMatchObject({ category: 'other', team: 'service-desk' });
    expect(p.confidence).toBeLessThan(0.5);
  });
});

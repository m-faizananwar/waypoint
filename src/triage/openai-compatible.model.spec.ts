import { LlmOutputError, OpenAiCompatibleTriageModel } from './openai-compatible.model';

const good = JSON.stringify({
  category: 'billing',
  priority: 'LOW',
  team: 'finance',
  summary: 'Duplicate invoice',
  confidence: 0.9,
  reasons: ['Mentions an invoice charged twice'],
});

function fakeFetch(responses: Array<{ status?: number; content?: string }>) {
  const calls: any[] = [];
  const impl = (async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    const next = responses.shift() ?? { status: 500 };
    return {
      ok: (next.status ?? 200) < 400,
      status: next.status ?? 200,
      json: async () => ({ choices: [{ message: { content: next.content } }] }),
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const make = (fetchImpl: typeof fetch) =>
  new OpenAiCompatibleTriageModel({ baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm', timeoutMs: 1000, fetchImpl });

describe('OpenAiCompatibleTriageModel', () => {
  const input = { title: 'Charged twice', body: 'Invoice 42 was charged twice' };

  it('returns a valid proposal on the first try', async () => {
    const { impl, calls } = fakeFetch([{ content: good }]);
    await expect(make(impl).propose(input)).resolves.toMatchObject({ category: 'billing' });
    expect(calls).toHaveLength(1);
    expect(calls[0].response_format).toEqual({ type: 'json_object' });
  });

  it('repairs once, sending the validation errors back to the model', async () => {
    const { impl, calls } = fakeFetch([{ content: '{"category":"money"}' }, { content: good }]);
    await expect(make(impl).propose(input)).resolves.toMatchObject({ team: 'finance' });
    expect(calls).toHaveLength(2);
    expect(calls[1].messages.at(-1).content).toContain('invalid');
  });

  it('gives up after one failed repair', async () => {
    const { impl } = fakeFetch([{ content: 'nope' }, { content: 'still nope' }]);
    await expect(make(impl).propose(input)).rejects.toBeInstanceOf(LlmOutputError);
  });

  it('throws on an HTTP error so the caller can fall back', async () => {
    const { impl } = fakeFetch([{ status: 503 }]);
    await expect(make(impl).propose(input)).rejects.toThrow('HTTP 503');
  });
});

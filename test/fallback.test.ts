import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompactionEngine, createOpenAICompatSummarizer } from '../src/index.js';
import type { CompactMessage } from '../src/index.js';

const SYSTEM: CompactMessage = { role: 'system', content: 'sys' };
function longConversation(): CompactMessage[] {
  return [
    SYSTEM,
    { role: 'user', content: '请帮我修复 login 页面的崩溃 bug ' + '细节 '.repeat(60) },
    { role: 'assistant', content: 'I found the null pointer in LoginForm.tsx line 42.' },
    ...Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `filler turn ${i} ${'lorem ipsum '.repeat(10)}`,
    })),
  ];
}

describe('fallback compaction', () => {
  it('degrades to a mechanical summary instead of failing the session', async () => {
    const engine = new CompactionEngine({
      contextWindow: 1000,
      keepRecentTokens: 200,
      minMessagesToCompact: 4,
      summarize: async () => {
        throw new Error('LLM down');
      },
    });

    const result = await engine.compact(longConversation(), { trigger: 'auto' });

    expect(result.stats.usedFallback).toBe(true);
    expect(result.messages[0]).toEqual(SYSTEM);
    expect(result.messages[1].content).toContain('[context compacted]');
    // The fallback keeps the original user request visible.
    expect(result.summary).toContain('请帮我修复 login 页面的崩溃 bug');
    // Structure stays intact: system + summary + verbatim tail.
    expect(result.messages.slice(2)).toEqual(longConversation().slice(result.splitIndex));
  });

  it('retains the previous summary across a fallback compaction', async () => {
    const marker = '[context compacted]';
    const engine = new CompactionEngine({
      contextWindow: 1000,
      keepRecentTokens: 200,
      minMessagesToCompact: 4,
      summarize: async () => {
        throw new Error('LLM down');
      },
    });

    const messages: CompactMessage[] = [
      SYSTEM,
      { role: 'user', content: `${marker}\n\n## Goal\nship v2` },
      ...longConversation().slice(1),
    ];
    const result = await engine.compact(messages);

    expect(result.stats.usedFallback).toBe(true);
    expect(result.summary).toContain('## Goal');
    expect(result.summary).toContain('ship v2');
  });
});

describe('createOpenAICompatSummarizer retry behaviour', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okResponse = () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: ' a fine summary ' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  it('succeeds after retrying transient server errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('server on fire', { status: 503 }))
      .mockResolvedValueOnce(new Response('still on fire', { status: 429 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const summarize = createOpenAICompatSummarizer({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'test-model',
      maxSummaryTokens: 512,
      timeoutMs: 1000,
      maxRetries: 2,
    });

    await expect(summarize({ messages: [{ role: 'user', content: 'hi' }] })).resolves.toBe(
      'a fine summary',
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Authorization header is sent when a key is available.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('does not retry non-retryable errors such as 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('bad key', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const summarize = createOpenAICompatSummarizer({
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
      maxSummaryTokens: 512,
      timeoutMs: 1000,
      maxRetries: 2,
    });

    await expect(summarize({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      'HTTP 401',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries on persistent failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const summarize = createOpenAICompatSummarizer({
      baseUrl: 'https://example.com/v1',
      model: 'test-model',
      maxSummaryTokens: 512,
      timeoutMs: 1000,
      maxRetries: 1,
    });

    await expect(summarize({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      'fetch failed',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

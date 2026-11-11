import { describe, expect, it, vi } from 'vitest';
import { CompactionEngine } from '../src/index.js';
import type { CompactMessage, SummaryRequest } from '../src/index.js';

const SYSTEM: CompactMessage = { role: 'system', content: 'You are a helpful agent.' };

/** 30 alternating user/assistant messages, ~31 tokens each with the heuristic. */
function longConversation(count = 30): CompactMessage[] {
  const messages: CompactMessage[] = [SYSTEM];
  for (let i = 0; i < count - 1; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${i}: ${'lorem ipsum dolor sit amet '.repeat(4)}`,
    });
  }
  return messages;
}

function makeEngine(
  overrides: Partial<ConstructorParameters<typeof CompactionEngine>[0]> = {},
  summarize?: (request: SummaryRequest) => Promise<string>,
) {
  const mock = summarize ?? (async () => 'MOCK SUMMARY');
  const spy = vi.fn(mock);
  const engine = new CompactionEngine({
    contextWindow: 1000,
    threshold: 0.8,
    keepRecentTokens: 200,
    minMessagesToCompact: 4,
    ...overrides,
    summarize: spy,
  });
  return { engine, spy };
}

describe('shouldCompact', () => {
  it('returns true when pressure reaches the threshold', () => {
    const { engine } = makeEngine();
    const messages = longConversation(30); // ≈ 930 tokens ≈ 0.93 pressure
    expect(engine.shouldCompact(messages)).toBe(true);
  });

  it('returns false below the threshold', () => {
    const { engine } = makeEngine();
    const messages = longConversation(20); // ≈ 620 tokens ≈ 0.62 pressure
    expect(engine.shouldCompact(messages)).toBe(false);
  });

  it('returns false for tiny conversations regardless of pressure', () => {
    const { engine } = makeEngine({ minMessagesToCompact: 50 });
    const messages = longConversation(30);
    expect(engine.shouldCompact(messages)).toBe(false);
  });

  it('exposes pressure and token estimates', () => {
    const { engine } = makeEngine();
    const messages = longConversation(30);
    expect(engine.getPressure(messages)).toBeCloseTo(engine.estimateTokens(messages) / 1000, 5);
    expect(engine.estimateTokens(messages)).toBeGreaterThan(0);
  });
});

describe('compact()', () => {
  it('produces [system..., summary message, tail...] and correct stats', async () => {
    const { engine, spy } = makeEngine();
    const messages = longConversation(30);

    const result = await engine.compact(messages, { trigger: 'auto' });

    expect(result.messages.length).toBe(1 + 1 + result.stats.keptCount);
    expect(result.messages[0]).toEqual(SYSTEM);

    const summaryMessage = result.messages[1];
    expect(summaryMessage.role).toBe('user');
    expect(typeof summaryMessage.content).toBe('string');
    expect(summaryMessage.content as string).toContain('[context compacted]');
    expect(summaryMessage.content as string).toContain('MOCK SUMMARY');

    // Tail is the verbatim slice of the original conversation.
    expect(result.messages.slice(2)).toEqual(messages.slice(result.splitIndex));

    expect(result.stats).toMatchObject({
      summarizedCount: result.splitIndex - 1, // minus the system prefix
      keptCount: messages.length - result.splitIndex,
      triggeredBy: 'auto',
      usedFallback: false,
    });
    expect(result.stats.beforeTokens).toBeGreaterThan(result.stats.afterTokens);

    // The summarizer saw exactly the old part (no system prefix, no tail).
    expect(spy).toHaveBeenCalledTimes(1);
    const request = spy.mock.calls[0][0] as SummaryRequest;
    expect(request.messages).toEqual(messages.slice(1, result.splitIndex));
    expect(request.previousSummary).toBeUndefined();
  });

  it('passes a manual focus hint through to the summarizer', async () => {
    const { engine, spy } = makeEngine();
    await engine.compact(longConversation(30), {
      trigger: 'manual',
      focus: 'keep the stack trace',
    });
    expect(spy.mock.calls[0][0]).toMatchObject({ focus: 'keep the stack trace' });
  });

  it('feeds the previous summary back on multi-round compaction', async () => {
    const { engine, spy } = makeEngine();
    const first = await engine.compact(longConversation(30));

    // Grow the compacted history, then compact again.
    const grown: CompactMessage[] = [
      ...first.messages,
      { role: 'user', content: 'new question ' + 'x'.repeat(80) },
      { role: 'assistant', content: 'new answer ' + 'y'.repeat(80) },
    ];
    spy.mockClear();
    const second = await engine.compact(grown);

    expect(second.stats.summarizedCount).toBeGreaterThan(0);
    const request = spy.mock.calls[0][0] as SummaryRequest;
    expect(request.previousSummary).toBe(first.summary);
    // The old summary message is merged into the new summary, not kept
    // alongside it: the result carries exactly one summary message.
    expect(request.messages.some((m) => m === first.messages[1])).toBe(true);
    const markerCount = second.messages.filter(
      (m) => typeof m.content === 'string' && m.content.startsWith('[context compacted]'),
    ).length;
    expect(markerCount).toBe(1);
  });

  it('returns messages unchanged when nothing needs summarizing', async () => {
    const { engine, spy } = makeEngine({ keepRecentTokens: 1_000_000 });
    const messages = longConversation(10);
    const result = await engine.compact(messages);

    expect(result.summary).toBe('');
    expect(result.messages).toEqual(messages);
    expect(result.stats.summarizedCount).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects when onError is "throw" and the summarizer fails', async () => {
    const { engine } = makeEngine(
      { onError: 'throw' },
      async () => {
        throw new Error('boom');
      },
    );
    await expect(engine.compact(longConversation(30))).rejects.toThrow('boom');
  });

  it('validates configuration', () => {
    expect(() => new CompactionEngine({ contextWindow: 0 })).toThrow();
    expect(() => new CompactionEngine({ contextWindow: -5 })).toThrow();
    expect(() => new CompactionEngine({ contextWindow: 100, threshold: 1.5 })).toThrow();
  });
});

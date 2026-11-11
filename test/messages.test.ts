import { describe, expect, it } from 'vitest';
import {
  buildSummaryMessage,
  extractPreviousSummary,
  findSplitIndex,
  partitionGroups,
  systemPrefixLength,
} from '../src/index.js';
import type { CompactMessage } from '../src/index.js';

/** Exact token control: 1 token per char. */
const countByChar = (text: string) => text.length;

const user = (text: string): CompactMessage => ({ role: 'user', content: text });
const assistant = (text: string): CompactMessage => ({ role: 'assistant', content: text });
const toolCall = (id: string): CompactMessage => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: '{}' } }],
});
const toolResult = (id: string, text: string): CompactMessage => ({
  role: 'tool',
  tool_call_id: id,
  content: text,
});

describe('systemPrefixLength', () => {
  it('counts only the leading system run', () => {
    const messages = [
      { role: 'system', content: 'a' },
      { role: 'system', content: 'b' },
      user('hello'),
      { role: 'system', content: 'mid-conversation' },
    ] as CompactMessage[];
    expect(systemPrefixLength(messages)).toBe(2);
  });

  it('returns 0 when there is no system message', () => {
    expect(systemPrefixLength([user('hi')])).toBe(0);
  });
});

describe('partitionGroups', () => {
  it('joins tool results with their originating assistant call', () => {
    const messages = [
      user('question'),
      toolCall('c1'),
      toolResult('c1', 'result a'),
      toolResult('c1', 'result b'),
      assistant('done'),
    ];
    const groups = partitionGroups(messages);
    expect(groups).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 4 }, // toolCall + two results are one atomic group
      { start: 4, end: 5 },
    ]);
  });

  it('keeps an orphan tool message as its own group instead of crashing', () => {
    const groups = partitionGroups([toolResult('x', 'lonely')]);
    expect(groups).toEqual([{ start: 0, end: 1 }]);
  });
});

describe('findSplitIndex', () => {
  it('returns the system prefix length when everything fits the budget', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      user('short'),
      assistant('short too'),
    ] as CompactMessage[];
    const split = findSplitIndex(messages, { keepRecentTokens: 10_000, countTokens: countByChar });
    expect(split).toBe(1);
  });

  it('keeps recent groups under the token budget', () => {
    const messages: CompactMessage[] = [
      { role: 'system', content: 'sys' },
      user('a'.repeat(100)), // 104 tokens
      user('b'.repeat(20)), // 24 tokens
      user('c'.repeat(20)), // 24 tokens
    ];
    // Budget 50: keeps the last two messages (24+24=48), drops the big one.
    const split = findSplitIndex(messages, { keepRecentTokens: 50, countTokens: countByChar });
    expect(split).toBe(2);
  });

  it('never starts the tail on a tool result — the whole call group is kept', () => {
    const messages: CompactMessage[] = [
      { role: 'system', content: 'sys' },
      user('a'.repeat(100)), // group [1], 104 tokens
      toolCall('c1'), // group [2, 4): tool_calls JSON ≈ 80 tokens
      toolResult('c1', 'r'.repeat(8)), // 14 tokens with overhead
      user('tail'), // 8 tokens, group [4]
    ];
    // Budget 120: keeps [toolCall, result, user] as one atomic unit.
    const split = findSplitIndex(messages, { keepRecentTokens: 120, countTokens: countByChar });
    expect(split).toBe(2);
    expect(messages[split].role).toBe('assistant');

    // Property: for any budget, the tail never begins on a tool message.
    for (const budget of [1, 8, 50, 102, 103, 206, 9999]) {
      const s = findSplitIndex(messages, { keepRecentTokens: budget, countTokens: countByChar });
      expect(s).toBeGreaterThanOrEqual(1);
      expect(messages[s].role).not.toBe('tool');
    }
  });

  it('always keeps at least one group even when it busts the budget', () => {
    const messages: CompactMessage[] = [
      user('a'.repeat(500)),
      user('b'.repeat(500)),
    ];
    const split = findSplitIndex(messages, { keepRecentTokens: 10, countTokens: countByChar });
    expect(split).toBe(1); // the last group is kept regardless
  });

  it('never crosses the system prefix', () => {
    const messages: CompactMessage[] = [
      { role: 'system', content: 's' },
      { role: 'system', content: 's2' },
      user('only message'),
    ] as CompactMessage[];
    const split = findSplitIndex(messages, { keepRecentTokens: 1, countTokens: countByChar });
    expect(split).toBeGreaterThanOrEqual(2);
  });

  it('handles empty conversations', () => {
    expect(findSplitIndex([], { keepRecentTokens: 100 })).toBe(0);
  });
});

describe('summary message round-trip', () => {
  it('buildSummaryMessage + extractPreviousSummary', () => {
    const marker = '[context compacted]';
    const message = buildSummaryMessage('## Goal\nfinish it', marker, 'user');
    const messages: CompactMessage[] = [
      { role: 'system', content: 'sys' },
      user('old'),
      message,
      user('recent'),
    ];
    const found = extractPreviousSummary(messages, marker);
    expect(found?.summary).toBe('## Goal\nfinish it');
    expect(found?.index).toBe(2);
  });

  it('extractPreviousSummary skips non-string content', () => {
    const marker = '[context compacted]';
    const messages: CompactMessage[] = [
      { role: 'user', content: [{ type: 'text', text: marker }] },
      buildSummaryMessage('real one', marker, 'user'),
    ];
    expect(extractPreviousSummary(messages, marker)?.index).toBe(1);
  });
});

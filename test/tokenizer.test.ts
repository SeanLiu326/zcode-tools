import { describe, expect, it } from 'vitest';
import {
  estimateConversationTokens,
  estimateMessageTokens,
  estimateTokens,
} from '../src/index.js';

describe('estimateTokens', () => {
  it('counts ~1 token per 4 non-CJK chars plus framing', () => {
    const text = 'abcdefgh'; // 8 chars
    expect(estimateTokens(text)).toBe(Math.ceil(8 / 4) + 2);
  });

  it('counts CJK chars more heavily than latin chars', () => {
    const cjk = '你好世界，测试文本'; // 9 CJK chars
    const latin = 'abcdefghi'; // 9 latin chars
    expect(estimateTokens(cjk)).toBeGreaterThan(estimateTokens(latin));
  });

  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('handles surrogate pairs without splitting', () => {
    // Should not throw and should count the emoji as one "other" char.
    expect(estimateTokens('👍👍')).toBe(Math.ceil(2 / 4) + 2);
  });
});

describe('estimateMessageTokens', () => {
  it('includes tool_calls JSON in the estimate', () => {
    const withCalls = estimateMessageTokens({
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
      ],
    });
    const withoutCalls = estimateMessageTokens({ role: 'assistant', content: null });
    expect(withCalls).toBeGreaterThan(withoutCalls);
  });

  it('charges per-message overhead', () => {
    expect(estimateMessageTokens({ role: 'user', content: '' })).toBeGreaterThan(0);
  });
});

describe('estimateConversationTokens', () => {
  it('is the sum of per-message estimates', () => {
    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    let sum = 0;
    for (const m of messages) sum += estimateMessageTokens(m);
    expect(estimateConversationTokens(messages)).toBe(sum);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { CompactionEngine, GoalManager } from '../src/index.js';
import type { CompactMessage, SummaryRequest } from '../src/index.js';

const SYSTEM: CompactMessage = { role: 'system', content: 'You are a helpful agent.' };

function longConversation(): CompactMessage[] {
  return [
    SYSTEM,
    ...Array.from({ length: 29 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn ${i}: ${'lorem ipsum dolor sit amet '.repeat(4)}`,
    })),
  ];
}

describe('GoalManager lifecycle', () => {
  it('set / get / isActive', () => {
    const goal = new GoalManager();
    expect(goal.get()).toBeUndefined();
    expect(goal.isActive()).toBe(false);

    goal.set('修复 login 页面崩溃');
    expect(goal.isActive()).toBe(true);
    expect(goal.get()).toMatchObject({ text: '修复 login 页面崩溃', status: 'active' });
    expect(goal.get()?.createdAt).toBe(goal.get()?.updatedAt);
  });

  it('addNote / complete / cancel update the timeline and status', () => {
    const goal = new GoalManager();
    goal.set('ship v2');

    goal.addNote('found the null pointer');
    expect(goal.get()?.notes).toHaveLength(1);
    expect(goal.get()?.notes[0].text).toBe('found the null pointer');

    goal.complete('released v2.0.1');
    expect(goal.isActive()).toBe(false);
    expect(goal.get()).toMatchObject({ status: 'completed' });
    expect(goal.get()?.notes.at(-1)?.text).toBe('released v2.0.1');
    expect(goal.get()?.createdAt).not.toBe(goal.get()?.updatedAt);
  });

  it('cancel records the reason and isActive becomes false', () => {
    const goal = new GoalManager();
    goal.set('migrate db');
    goal.cancel('rolled back by ops');
    expect(goal.get()).toMatchObject({ status: 'cancelled' });
    expect(goal.get()?.notes.at(-1)?.text).toBe('rolled back by ops');
  });

  it('clear removes the goal entirely', () => {
    const goal = new GoalManager();
    goal.set('x');
    goal.clear();
    expect(goal.get()).toBeUndefined();
    expect(goal.promptBlock()).toBe('');
  });

  it('throws when mutating without an active goal', () => {
    const goal = new GoalManager();
    expect(() => goal.addNote('x')).toThrow();
    expect(() => goal.complete()).toThrow();
    expect(() => goal.cancel()).toThrow();
  });

  it('set replaces an existing goal', () => {
    const goal = new GoalManager();
    goal.set('old goal');
    goal.addNote('progress on old');
    goal.set('new goal');
    expect(goal.get()).toMatchObject({ text: 'new goal', status: 'active', notes: [] });
  });
});

describe('GoalManager prompt block', () => {
  it('returns empty string when no goal was ever set', () => {
    expect(new GoalManager().promptBlock()).toBe('');
  });

  it('renders goal, status and notes, capped to the 5 most recent notes', () => {
    const goal = new GoalManager();
    goal.set('修复 login 崩溃');
    for (let i = 1; i <= 7; i++) goal.addNote(`note ${i}`);

    const block = goal.promptBlock();
    expect(block.startsWith('[active goal]')).toBe(true);
    expect(block).toContain('Goal: 修复 login 崩溃');
    expect(block).toContain('Status: active');
    expect(block).toContain('- note 7');
    expect(block).toContain('- note 3'); // 7 - 5 + 1
    expect(block).not.toContain('- note 2');
  });

  it('buildMessage wraps the block in a user message', () => {
    const goal = new GoalManager();
    expect(goal.buildMessage()).toBeUndefined();
    goal.set('do the thing');
    const message = goal.buildMessage();
    expect(message).toMatchObject({ role: 'user' });
    expect(message?.content).toBe(goal.promptBlock());
  });

  it('toJSON / fromJSON round-trip', () => {
    const goal = new GoalManager();
    goal.set('persisted objective');
    goal.addNote('halfway there');

    const restored = GoalManager.fromJSON(goal.toJSON());
    expect(restored.get()).toEqual(goal.get());
    expect(restored.promptBlock()).toBe(goal.promptBlock());
    expect(restored.isActive()).toBe(true);

    expect(GoalManager.fromJSON(undefined).get()).toBeUndefined();
  });
});

describe('engine goal integration', () => {
  function makeEngine(goal?: GoalManager) {
    const spy = vi.fn(async () => 'MOCK SUMMARY');
    const engine = new CompactionEngine({
      contextWindow: 1000,
      keepRecentTokens: 200,
      minMessagesToCompact: 4,
      goal,
      summarize: spy,
    });
    return { engine, spy };
  }

  it('passes the active goal to the summarizer and adds one reminder message', async () => {
    const goal = new GoalManager();
    goal.set('修复 login 页面崩溃');
    goal.addNote('已定位到 LoginForm.tsx 第 42 行');

    const { engine, spy } = makeEngine(goal);
    const messages = longConversation();
    const result = await engine.compact(messages, { trigger: 'auto' });

    // Summarizer saw the goal block.
    const request = spy.mock.calls[0][0] as SummaryRequest;
    expect(request.activeGoal).toContain('修复 login 页面崩溃');
    expect(request.activeGoal).toContain('已定位到 LoginForm.tsx');

    // Result: [system, summary, goal, ...tail] — exactly one goal reminder.
    expect(result.messages).toHaveLength(3 + result.stats.keptCount);
    expect(result.messages[1].content).toContain('[context compacted]');
    expect(result.messages[2]?.content).toContain('[active goal]');
    expect(result.messages[2]?.role).toBe('user');
    expect(result.messages.slice(3)).toEqual(messages.slice(result.splitIndex));
    const goalCount = result.messages.filter(
      (m) => typeof m.content === 'string' && m.content.startsWith('[active goal]'),
    ).length;
    expect(goalCount).toBe(1);
  });

  it('adds no goal message when the engine has no goal or it is finished', async () => {
    const finished = new GoalManager();
    finished.set('old objective');
    finished.complete('done');

    for (const goal of [undefined, finished]) {
      const { engine, spy } = makeEngine(goal);
      const result = await engine.compact(longConversation());
      const request = spy.mock.calls[0][0] as SummaryRequest;
      expect(request.activeGoal).toBeUndefined();
      expect(
        result.messages.filter(
          (m) => typeof m.content === 'string' && m.content.startsWith('[active goal]'),
        ),
      ).toHaveLength(0);
      expect(result.messages[1].content).toContain('[context compacted]');
      expect(result.messages[2]).toBeDefined(); // tail starts right after the summary
    }
  });

  it('keeps the goal reminder through fallback compaction', async () => {
    const goal = new GoalManager();
    goal.set('修复 login 页面崩溃');

    const engine = new CompactionEngine({
      contextWindow: 1000,
      keepRecentTokens: 200,
      minMessagesToCompact: 4,
      goal,
      summarize: async () => {
        throw new Error('LLM down');
      },
    });
    const result = await engine.compact(longConversation());

    expect(result.stats.usedFallback).toBe(true);
    expect(result.summary).toContain('## Standing goal');
    expect(result.summary).toContain('修复 login 页面崩溃');
    expect(
      result.messages.filter(
        (m) => typeof m.content === 'string' && m.content.startsWith('[active goal]'),
      ),
    ).toHaveLength(1);
  });

  it('absorbs the old goal message on re-compaction — always exactly one reminder', async () => {
    const goal = new GoalManager();
    goal.set('修复 login 页面崩溃');

    const { engine, spy } = makeEngine(goal);
    const first = await engine.compact(longConversation());

    // Progress happens, then the session grows past the tail again.
    goal.addNote('已修复，等待回归测试');
    const grown: CompactMessage[] = [
      ...first.messages,
      { role: 'user', content: '回归测试又挂了 ' + 'x'.repeat(90) },
      { role: 'assistant', content: '查看 CI 日志 ' + 'y'.repeat(90) },
    ];
    spy.mockClear();
    const second = await engine.compact(grown);

    const goalMessages = second.messages.filter(
      (m) => typeof m.content === 'string' && m.content.startsWith('[active goal]'),
    );
    expect(goalMessages).toHaveLength(1);
    // The reminder reflects the GoalManager's current state.
    expect(goalMessages[0].content).toContain('已修复，等待回归测试');
    // The stale goal message was summarized (absorbed), not kept verbatim.
    const request = spy.mock.calls[0][0] as SummaryRequest;
    expect(request.messages.some((m) => m === first.messages[2])).toBe(true);
    expect(request.previousSummary).toBe(first.summary);
  });

  it('never starts the kept tail on a tool message when a goal message shifts the split', async () => {
    const goal = new GoalManager();
    goal.set('goal near the tail');
    const { engine } = makeEngine(goal);

    const messages: CompactMessage[] = [
      SYSTEM,
      { role: 'user', content: `${goal.marker}\n${'g'.repeat(200)}` }, // stale goal reminder
      { role: 'user', content: 'a'.repeat(100) },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ls', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'file list' },
      { role: 'user', content: 'tail question' },
    ];
    const result = await engine.compact(messages);
    const firstTail = result.messages[3]; // system, summary, goal, then tail
    expect(firstTail?.role).not.toBe('tool');
    expect(result.messages.slice(3)).toEqual(messages.slice(result.splitIndex));
  });
});

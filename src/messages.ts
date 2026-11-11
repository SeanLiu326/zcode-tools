/**
 * Conversation splitting utilities — the correctness core of compaction.
 *
 * The history is partitioned into atomic "exchange groups": a message starts a
 * new group, and `role: 'tool'` results always join the group of the assistant
 * `tool_calls` message that produced them. Splitting is only allowed between
 * groups, so a tool result can never be orphaned from its call (which
 * OpenAI-compatible APIs reject), and the leading `system` run is always
 * preserved verbatim.
 */

import type { CompactMessage } from './types.js';
import { estimateMessageTokens, estimateTokens, type TokenCounter } from './tokenizer.js';

/** Number of leading `system` messages. These are never summarized. */
export function systemPrefixLength(messages: readonly CompactMessage[]): number {
  let count = 0;
  while (count < messages.length && messages[count].role === 'system') {
    count++;
  }
  return count;
}

/**
 * Partition `messages` into atomic exchange groups as half-open ranges
 * `[start, end)` of indices.
 */
export function partitionGroups(
  messages: readonly CompactMessage[],
  from = 0,
): Array<{ start: number; end: number }> {
  const groups: Array<{ start: number; end: number }> = [];
  for (let i = from; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === 'tool' && groups.length > 0) {
      // A tool result always belongs to the group of its originating call.
      groups[groups.length - 1].end = i + 1;
    } else {
      groups.push({ start: i, end: i + 1 });
    }
  }
  return groups;
}

function groupTokens(
  messages: readonly CompactMessage[],
  group: { start: number; end: number },
  countTokens: TokenCounter,
): number {
  let total = 0;
  for (let i = group.start; i < group.end; i++) {
    total += estimateMessageTokens(messages[i], countTokens);
  }
  return total;
}

/**
 * Find the index where the verbatim-kept tail begins.
 *
 * Walks exchange groups from the end of the conversation, greedily keeping
 * whole groups while they fit in `keepRecentTokens`. Guarantees:
 * - the tail always contains at least one group (even if oversized),
 * - the split never lands inside a tool-call group,
 * - the split never falls into the leading `system` run.
 *
 * Returns `systemPrefixLength(messages)` when everything fits (nothing to
 * summarize).
 */
export function findSplitIndex(
  messages: readonly CompactMessage[],
  options: { keepRecentTokens: number; countTokens?: TokenCounter },
): number {
  const countTokens = options.countTokens ?? estimateTokens;
  const systemCount = systemPrefixLength(messages);
  const groups = partitionGroups(messages, systemCount);
  if (groups.length === 0) return systemCount;

  // Always keep at least the last group, even if it alone busts the budget.
  let tailStart = groups.length - 1;
  let tokens = groupTokens(messages, groups[tailStart], countTokens);
  for (let g = groups.length - 2; g >= 0; g--) {
    const extra = groupTokens(messages, groups[g], countTokens);
    if (tokens + extra > options.keepRecentTokens) break;
    tokens += extra;
    tailStart = g;
  }
  return groups[tailStart].start;
}

/** Build the summary message inserted into the compacted history. */
export function buildSummaryMessage(
  summary: string,
  marker: string,
  role: 'user' | 'system',
): CompactMessage {
  return { role, content: `${marker}\n\n${summary}` };
}

/** Find the first message (from `from`) whose string content starts with `marker`. */
export function findMarkerIndex(
  messages: readonly CompactMessage[],
  marker: string,
  from = 0,
): number {
  for (let i = from; i < messages.length; i++) {
    const content = messages[i].content;
    if (typeof content === 'string' && content.startsWith(marker)) return i;
  }
  return -1;
}

/**
 * Find the standing summary from a previous compaction, if any.
 * Returns its text (marker line stripped) and its message index.
 */
export function extractPreviousSummary(
  messages: readonly CompactMessage[],
  marker: string,
): { summary: string; index: number } | undefined {
  const index = findMarkerIndex(messages, marker, systemPrefixLength(messages));
  if (index === -1) return undefined;
  const content = messages[index].content as string;
  return { summary: content.slice(marker.length).trimStart(), index };
}

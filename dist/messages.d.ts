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
import { type TokenCounter } from './tokenizer.js';
/** Number of leading `system` messages. These are never summarized. */
export declare function systemPrefixLength(messages: readonly CompactMessage[]): number;
/**
 * Partition `messages` into atomic exchange groups as half-open ranges
 * `[start, end)` of indices.
 */
export declare function partitionGroups(messages: readonly CompactMessage[], from?: number): Array<{
    start: number;
    end: number;
}>;
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
export declare function findSplitIndex(messages: readonly CompactMessage[], options: {
    keepRecentTokens: number;
    countTokens?: TokenCounter;
}): number;
/** Build the summary message inserted into the compacted history. */
export declare function buildSummaryMessage(summary: string, marker: string, role: 'user' | 'system'): CompactMessage;
/** Find the first message (from `from`) whose string content starts with `marker`. */
export declare function findMarkerIndex(messages: readonly CompactMessage[], marker: string, from?: number): number;
/**
 * Find the standing summary from a previous compaction, if any.
 * Returns its text (marker line stripped) and its message index.
 */
export declare function extractPreviousSummary(messages: readonly CompactMessage[], marker: string): {
    summary: string;
    index: number;
} | undefined;
//# sourceMappingURL=messages.d.ts.map
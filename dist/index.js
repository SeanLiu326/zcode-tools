/**
 * context-compaction — dsh-style context compaction for LLM agent sessions.
 *
 * @example
 * ```ts
 * import { CompactionEngine } from 'context-compaction';
 *
 * const engine = new CompactionEngine({
 *   contextWindow: 128_000,
 *   baseUrl: 'https://api.deepseek.com/v1',
 *   model: 'deepseek-chat',
 * });
 *
 * // In the agent loop, at a step boundary:
 * if (engine.shouldCompact(messages)) {
 *   const result = await engine.compact(messages, { trigger: 'auto' });
 *   messages = result.messages; // [system..., summary, recent tail...]
 * }
 * ```
 */
export { CompactionEngine, DEFAULT_THRESHOLD } from './engine.js';
export { estimateConversationTokens, estimateMessageTokens, estimateTokens, } from './tokenizer.js';
export { buildSummaryMessage, extractPreviousSummary, findMarkerIndex, findSplitIndex, partitionGroups, systemPrefixLength, } from './messages.js';
export { GoalManager } from './goal.js';
export { COMPACTION_SYSTEM_PROMPT, buildCompactionUserPrompt, buildFallbackSummary, serializeForSummary, } from './prompts.js';
export { createOpenAICompatSummarizer } from './llm.js';
//# sourceMappingURL=index.js.map
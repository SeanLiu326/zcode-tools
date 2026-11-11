/**
 * Token estimation.
 *
 * The default counter is a heuristic — good enough for pressure detection
 * (compaction triggering a bit early is harmless; too late overflows the
 * window). For exact counts, inject `countTokens` (e.g. tiktoken or a
 * provider-side count endpoint) via `CompactionConfig.countTokens`.
 */
export type TokenCounter = (text: string) => number;
/**
 * Estimate the token count of a plain text string.
 *
 * Heuristic: ~1 token per CJK char (slightly over-estimated on purpose),
 * ~1 token per 4 other chars, plus a small constant for framing.
 */
export declare function estimateTokens(text: string): number;
/**
 * Estimate the token count of a single chat message, including tool calls,
 * tool-call ids and JSON-serialized multimodal content.
 */
export declare function estimateMessageTokens(message: {
    role: string;
    content?: unknown;
    tool_calls?: unknown;
    tool_call_id?: string;
}, countTokens?: TokenCounter): number;
/** Estimate the token count of a whole conversation. */
export declare function estimateConversationTokens(messages: readonly unknown[], countTokens?: TokenCounter): number;
//# sourceMappingURL=tokenizer.d.ts.map
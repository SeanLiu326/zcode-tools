/**
 * Token estimation.
 *
 * The default counter is a heuristic — good enough for pressure detection
 * (compaction triggering a bit early is harmless; too late overflows the
 * window). For exact counts, inject `countTokens` (e.g. tiktoken or a
 * provider-side count endpoint) via `CompactionConfig.countTokens`.
 */
const CJK_RE = /[\u2E80-\u2EFF\u3000-\u303F\u31C0-\u31EF\u3200-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;
/**
 * Estimate the token count of a plain text string.
 *
 * Heuristic: ~1 token per CJK char (slightly over-estimated on purpose),
 * ~1 token per 4 other chars, plus a small constant for framing.
 */
export function estimateTokens(text) {
    if (!text)
        return 0;
    let cjk = 0;
    let other = 0;
    for (const ch of text) {
        if (CJK_RE.test(ch))
            cjk++;
        else
            other++;
    }
    return Math.ceil(cjk * 1.0 + other / 4) + 2;
}
/** Extra tokens charged per message for role/framing overhead. */
const PER_MESSAGE_OVERHEAD = 4;
/**
 * Estimate the token count of a single chat message, including tool calls,
 * tool-call ids and JSON-serialized multimodal content.
 */
export function estimateMessageTokens(message, countTokens = estimateTokens) {
    let total = PER_MESSAGE_OVERHEAD;
    const { content, tool_calls, tool_call_id } = message;
    if (typeof content === 'string') {
        total += countTokens(content);
    }
    else if (content != null) {
        // Multimodal / structured content: count its JSON form.
        total += countTokens(JSON.stringify(content));
    }
    if (tool_calls) {
        total += countTokens(JSON.stringify(tool_calls));
    }
    if (tool_call_id) {
        total += countTokens(tool_call_id);
    }
    return total;
}
/** Estimate the token count of a whole conversation. */
export function estimateConversationTokens(messages, countTokens = estimateTokens) {
    let total = 0;
    for (const message of messages) {
        if (message && typeof message === 'object') {
            total += estimateMessageTokens(message, countTokens);
        }
    }
    return total;
}
//# sourceMappingURL=tokenizer.js.map
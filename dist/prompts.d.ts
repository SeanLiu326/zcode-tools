/**
 * Compaction-turn prompts and message serialization.
 *
 * The compaction turn is a dedicated LLM call whose only job is to produce a
 * handoff summary — it never executes the task itself.
 */
import type { CompactMessage, SummaryRequest } from './types.js';
export declare const COMPACTION_SYSTEM_PROMPT: string;
/**
 * Serialize the old part of the conversation into an indexed transcript for
 * the summarizer. Long messages and tool results are truncated with a marker.
 */
export declare function serializeForSummary(messages: readonly CompactMessage[], itemCharLimit?: number): string;
/** Build the user message of the compaction turn. */
export declare function buildCompactionUserPrompt(request: SummaryRequest): string;
/**
 * Mechanical fallback summary used when the LLM call fails. It keeps the
 * structure of a real summary and never interrupts the session.
 */
export declare function buildFallbackSummary(request: SummaryRequest, maxItems?: number): string;
//# sourceMappingURL=prompts.d.ts.map
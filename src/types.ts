/**
 * Core message and configuration types.
 *
 * Messages follow the OpenAI chat-completions shape, so the module can be
 * dropped into any agent that talks to an OpenAI-compatible API.
 * Provider-specific extra fields are preserved verbatim through compaction.
 */

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

/** Multimodal content parts (e.g. `{ type: 'text', text: ... }`, images). */
export type ContentPart = Record<string, unknown>;

export type MessageContent = string | ContentPart[] | null;

export interface CompactMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: MessageContent;
  tool_calls?: ToolCall[];
  /** Present on `role: 'tool'` messages, referencing the originating call. */
  tool_call_id?: string;
  name?: string;
  /** Any extra provider-specific fields are preserved as-is. */
  [key: string]: unknown;
}

/** What a summary generator receives. */
export interface SummaryRequest {
  /** The older part of the conversation to summarize (system messages excluded). */
  messages: CompactMessage[];
  /**
   * The summary produced by the previous compaction, if one is present in the
   * history (multi-round compaction). The generator should merge it in.
   */
  previousSummary?: string;
  /** Extra emphasis hint, e.g. from a manual `/compact` invocation. */
  focus?: string;
  /**
   * Rendered goal block (from `GoalManager.promptBlock()`) when the engine
   * holds an active goal. The summarizer must keep the summary aligned with it.
   */
  activeGoal?: string;
}

/** Pluggable summary generation. Defaults to the built-in OpenAI-compatible client. */
export type SummaryGenerator = (request: SummaryRequest) => Promise<string>;

export interface CompactionConfig {
  /** Model context window size in tokens. */
  contextWindow: number;
  /**
   * Compaction triggers when estimated pressure (tokens / contextWindow)
   * reaches this ratio. dsh-style default: 0.8.
   */
  threshold?: number;
  /**
   * Token budget for the verbatim-recent tail kept after compaction.
   * Default: 20% of contextWindow.
   */
  keepRecentTokens?: number;
  /**
   * `shouldCompact()` returns false below this message count, so tiny
   * conversations never get compacted. Default: 8.
   */
  minMessagesToCompact?: number;
  /** Role used for the summary message inserted into the history. Default: 'user'. */
  summaryRole?: 'user' | 'system';
  /**
   * Stable prefix marking a compaction summary message, used both for display
   * and to detect previous summaries on re-compaction. Default: '[context compacted]'.
   */
  summaryMarker?: string;
  /** Retry attempts for the summary LLM call. Default: 2 (i.e. up to 3 attempts). */
  maxRetries?: number;
  /**
   * 'fallback' (default): degrade to a mechanical summary when the LLM call
   * fails after retries, so compaction never breaks the session.
   * 'throw': re-raise the error instead.
   */
  onError?: 'fallback' | 'throw';
  /** Pluggable token counter. Default: the built-in CJK-aware heuristic. */
  countTokens?: (text: string) => number;
  /** Pluggable summary generator. Default: built-in OpenAI-compatible client. */
  summarize?: SummaryGenerator;
  /**
   * Optional dsh-style goal manager. When it holds an active goal, compaction
   * passes it to the summarizer and adds a goal reminder message to the
   * compacted history, so the objective survives compaction.
   */
  goal?: import('./goal.js').GoalManager;
  // --- Built-in OpenAI-compatible client options (used when `summarize` is not given) ---
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** Max tokens for the generated summary. Default: 2048. */
  maxSummaryTokens?: number;
  /** Per-attempt timeout in ms for the summary call. Default: 120_000. */
  timeoutMs?: number;
}

/** All defaults applied; what the engine actually runs with. */
export interface ResolvedCompactionConfig {
  contextWindow: number;
  threshold: number;
  keepRecentTokens: number;
  minMessagesToCompact: number;
  summaryRole: 'user' | 'system';
  summaryMarker: string;
  maxRetries: number;
  onError: 'fallback' | 'throw';
  countTokens: (text: string) => number;
  summarize: SummaryGenerator;
  goal?: import('./goal.js').GoalManager;
  maxSummaryTokens: number;
  timeoutMs: number;
}

export interface CompactionStats {
  beforeTokens: number;
  afterTokens: number;
  /** Number of messages replaced by the summary. */
  summarizedCount: number;
  /** Number of recent messages kept verbatim. */
  keptCount: number;
  triggeredBy: 'auto' | 'manual';
  /** True when the LLM call failed and the mechanical fallback was used. */
  usedFallback: boolean;
}

export interface CompactionResult {
  /** The compacted history: [system..., summary message, recent tail...]. */
  messages: CompactMessage[];
  /** The generated handoff summary text (without the marker prefix). */
  summary: string;
  /** Index in the *original* array where the kept tail began. */
  splitIndex: number;
  stats: CompactionStats;
}

export interface CompactionOptions {
  trigger?: 'auto' | 'manual';
  /** Extra emphasis hint passed to the summarizer (manual `/compact focus`). */
  focus?: string;
}

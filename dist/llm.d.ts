/**
 * Built-in summary generator for OpenAI-compatible chat-completions APIs
 * (DeepSeek, GLM, Kimi, OpenAI itself, local vLLM/ollama, ...).
 *
 * Zero dependencies: uses the global `fetch` available in Node 18+.
 */
import type { SummaryGenerator } from './types.js';
export interface OpenAICompatOptions {
    baseUrl: string;
    apiKey?: string;
    model: string;
    maxSummaryTokens: number;
    timeoutMs: number;
    maxRetries: number;
}
/**
 * Create a `SummaryGenerator` backed by an OpenAI-compatible endpoint.
 * Retries transient failures (network errors, 408/429/5xx) with exponential
 * backoff; non-retryable HTTP errors are surfaced immediately.
 */
export declare function createOpenAICompatSummarizer(options: OpenAICompatOptions): SummaryGenerator;
//# sourceMappingURL=llm.d.ts.map
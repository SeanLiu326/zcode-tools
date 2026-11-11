/**
 * Built-in summary generator for OpenAI-compatible chat-completions APIs
 * (DeepSeek, GLM, Kimi, OpenAI itself, local vLLM/ollama, ...).
 *
 * Zero dependencies: uses the global `fetch` available in Node 18+.
 */
import { COMPACTION_SYSTEM_PROMPT, buildCompactionUserPrompt } from './prompts.js';
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
/** Marks errors that must abort retrying immediately. */
class NonRetryableError extends Error {
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function resolveApiKey(explicit) {
    if (explicit)
        return explicit;
    return (process.env.OPENAI_API_KEY ??
        process.env.DEEPSEEK_API_KEY ??
        process.env.ZHIPUAI_API_KEY ??
        process.env.MOONSHOT_API_KEY ??
        '');
}
/**
 * Create a `SummaryGenerator` backed by an OpenAI-compatible endpoint.
 * Retries transient failures (network errors, 408/429/5xx) with exponential
 * backoff; non-retryable HTTP errors are surfaced immediately.
 */
export function createOpenAICompatSummarizer(options) {
    const { baseUrl, model, maxSummaryTokens, timeoutMs, maxRetries } = options;
    return async function summarize(request) {
        const apiKey = resolveApiKey(options.apiKey);
        const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
        const body = {
            model,
            max_tokens: maxSummaryTokens,
            temperature: 0.2,
            messages: [
                { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
                { role: 'user', content: buildCompactionUserPrompt(request) },
            ],
        };
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0)
                await delay(500 * 2 ** (attempt - 1));
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
                if (!response.ok) {
                    const text = await response.text().catch(() => '');
                    if (!RETRYABLE_STATUS.has(response.status)) {
                        throw new NonRetryableError(`Summary request failed: HTTP ${response.status} ${text.slice(0, 300)}`);
                    }
                    lastError = new Error(`Summary request failed: HTTP ${response.status} ${text.slice(0, 300)}`);
                    continue;
                }
                const data = (await response.json());
                const content = data.choices?.[0]?.message?.content;
                if (typeof content !== 'string' || content.trim() === '') {
                    throw new Error('Summary request returned an empty completion.');
                }
                return content.trim();
            }
            catch (error) {
                if (error instanceof NonRetryableError)
                    throw error;
                // Everything else (network failures, aborts, empty completions) retries.
                lastError = error;
            }
            finally {
                clearTimeout(timer);
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };
}
//# sourceMappingURL=llm.js.map
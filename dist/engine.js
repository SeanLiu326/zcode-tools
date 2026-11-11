/**
 * CompactionEngine — the dsh-style compaction entry point.
 *
 * Usage in an agent loop (auto compaction at a step boundary):
 *
 *   if (engine.shouldCompact(messages)) {
 *     const result = await engine.compact(messages, { trigger: 'auto' });
 *     messages = result.messages;
 *   }
 *
 * Manual trigger (a `/compact [focus]` command):
 *
 *   const result = await engine.compact(messages, { trigger: 'manual', focus });
 */
import { estimateConversationTokens, estimateTokens } from './tokenizer.js';
import { buildSummaryMessage, extractPreviousSummary, findMarkerIndex, findSplitIndex, systemPrefixLength, } from './messages.js';
import { buildFallbackSummary } from './prompts.js';
import { createOpenAICompatSummarizer } from './llm.js';
export const DEFAULT_THRESHOLD = 0.8;
/** Default OpenAI-compatible endpoint; override `baseUrl` for other providers. */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
export class CompactionEngine {
    config;
    constructor(config) {
        if (!config.contextWindow || config.contextWindow <= 0) {
            throw new Error('CompactionEngine requires a positive `contextWindow`.');
        }
        const threshold = config.threshold ?? DEFAULT_THRESHOLD;
        if (threshold <= 0 || threshold > 1) {
            throw new Error('`threshold` must be in (0, 1].');
        }
        this.config = {
            contextWindow: config.contextWindow,
            threshold,
            keepRecentTokens: config.keepRecentTokens ?? Math.floor(config.contextWindow * 0.2),
            minMessagesToCompact: config.minMessagesToCompact ?? 8,
            summaryRole: config.summaryRole ?? 'user',
            summaryMarker: config.summaryMarker ?? '[context compacted]',
            maxRetries: config.maxRetries ?? 2,
            onError: config.onError ?? 'fallback',
            countTokens: config.countTokens ?? estimateTokens,
            summarize: config.summarize ??
                createOpenAICompatSummarizer({
                    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
                    apiKey: config.apiKey,
                    model: config.model ?? DEFAULT_MODEL,
                    maxSummaryTokens: config.maxSummaryTokens ?? 2048,
                    timeoutMs: config.timeoutMs ?? 120_000,
                    maxRetries: config.maxRetries ?? 2,
                }),
            maxSummaryTokens: config.maxSummaryTokens ?? 2048,
            timeoutMs: config.timeoutMs ?? 120_000,
            goal: config.goal,
        };
    }
    /** Estimated token count of the whole conversation. */
    estimateTokens(messages) {
        return estimateConversationTokens(messages, this.config.countTokens);
    }
    /** Estimated context pressure, in [0, 1+). */
    getPressure(messages) {
        return this.estimateTokens(messages) / this.config.contextWindow;
    }
    /**
     * Whether auto compaction should fire at this step boundary: enough
     * messages and pressure at/over the threshold.
     */
    shouldCompact(messages) {
        if (messages.length < this.config.minMessagesToCompact)
            return false;
        return this.getPressure(messages) >= this.config.threshold;
    }
    /**
     * Compact the conversation: replace everything between the system prefix
     * and the kept tail with a handoff summary.
     *
     * When there is nothing to summarize (the whole history already fits in the
     * tail budget), the input messages are returned unchanged.
     */
    async compact(messages, options = {}) {
        const { config } = this;
        const beforeTokens = this.estimateTokens(messages);
        const systemCount = systemPrefixLength(messages);
        let splitIndex = findSplitIndex(messages, {
            keepRecentTokens: config.keepRecentTokens,
            countTokens: config.countTokens,
        });
        const previous = extractPreviousSummary(messages, config.summaryMarker);
        // Guarantee the result carries exactly ONE summary message: if the
        // previous summary fell into the kept tail, pull it into the summarized
        // part so it is merged into the new summary instead of lingering.
        // (previous.index + 1 is always a group boundary — a summary message
        // starts its own exchange group.)
        if (previous && previous.index >= splitIndex) {
            splitIndex = previous.index + 1;
        }
        // Same guarantee for the goal reminder: an old goal message in the tail
        // is absorbed into the summarized part, so the compacted history keeps
        // exactly one — reflecting the GoalManager's current state.
        if (config.goal) {
            const goalIndex = findMarkerIndex(messages, config.goal.marker, systemCount);
            if (goalIndex !== -1 && goalIndex >= splitIndex) {
                splitIndex = goalIndex + 1;
            }
        }
        const systemPart = messages.slice(0, systemCount);
        const oldPart = messages.slice(systemCount, splitIndex);
        const tail = messages.slice(splitIndex);
        if (oldPart.length === 0) {
            // Nothing older than the tail — no compaction needed.
            return {
                messages: [...messages],
                summary: '',
                splitIndex,
                stats: {
                    beforeTokens,
                    afterTokens: beforeTokens,
                    summarizedCount: 0,
                    keptCount: tail.length,
                    triggeredBy: options.trigger ?? 'manual',
                    usedFallback: false,
                },
            };
        }
        const activeGoalBlock = config.goal?.isActive() ? config.goal.promptBlock() : undefined;
        const summaryRequest = {
            messages: oldPart,
            previousSummary: previous?.summary,
            focus: options.focus,
            activeGoal: activeGoalBlock,
        };
        let summary;
        let usedFallback = false;
        try {
            summary = await config.summarize(summaryRequest);
        }
        catch (error) {
            if (config.onError === 'throw')
                throw error;
            summary = buildFallbackSummary(summaryRequest);
            usedFallback = true;
        }
        const summaryMessage = buildSummaryMessage(summary, config.summaryMarker, config.summaryRole);
        const result = [...systemPart, summaryMessage];
        // The goal lives outside the history, so it always survives compaction;
        // a reminder right after the summary re-anchors the next steps.
        const goalMessage = activeGoalBlock
            ? { role: 'user', content: activeGoalBlock }
            : undefined;
        if (goalMessage)
            result.push(goalMessage);
        result.push(...tail);
        const afterTokens = this.estimateTokens(result);
        return {
            messages: result,
            summary,
            splitIndex,
            stats: {
                beforeTokens,
                afterTokens,
                summarizedCount: oldPart.length,
                keptCount: tail.length,
                triggeredBy: options.trigger ?? 'manual',
                usedFallback,
            },
        };
    }
}
//# sourceMappingURL=engine.js.map
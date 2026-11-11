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
import type { CompactMessage, CompactionConfig, CompactionOptions, CompactionResult, ResolvedCompactionConfig } from './types.js';
export declare const DEFAULT_THRESHOLD = 0.8;
export declare class CompactionEngine {
    readonly config: ResolvedCompactionConfig;
    constructor(config: CompactionConfig);
    /** Estimated token count of the whole conversation. */
    estimateTokens(messages: readonly CompactMessage[]): number;
    /** Estimated context pressure, in [0, 1+). */
    getPressure(messages: readonly CompactMessage[]): number;
    /**
     * Whether auto compaction should fire at this step boundary: enough
     * messages and pressure at/over the threshold.
     */
    shouldCompact(messages: readonly CompactMessage[]): boolean;
    /**
     * Compact the conversation: replace everything between the system prefix
     * and the kept tail with a handoff summary.
     *
     * When there is nothing to summarize (the whole history already fits in the
     * tail budget), the input messages are returned unchanged.
     */
    compact(messages: readonly CompactMessage[], options?: CompactionOptions): Promise<CompactionResult>;
}
//# sourceMappingURL=engine.d.ts.map
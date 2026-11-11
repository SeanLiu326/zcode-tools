/**
 * Goal mechanism — dsh-style objective management that keeps long sessions
 * from drifting.
 *
 * The goal lives OUTSIDE the message history, so compaction can never drop
 * it. Hosts inject `promptBlock()` into the system prompt at every step, and
 * the compaction engine passes the standing goal to the summarizer and adds a
 * goal reminder to the compacted history. No hidden persistence: the host
 * wires `toJSON()`/`fromJSON()` into its own session log.
 */
import type { CompactMessage } from './types.js';
export type GoalStatus = 'active' | 'completed' | 'cancelled';
export interface GoalNote {
    text: string;
    /** ISO timestamp. */
    at: string;
}
export interface GoalRecord {
    text: string;
    status: GoalStatus;
    notes: GoalNote[];
    createdAt: string;
    updatedAt: string;
}
export declare class GoalManager {
    /** Stable prefix identifying goal reminder messages in the history. */
    readonly marker: string;
    private record?;
    constructor(marker?: string);
    /** Set (or replace) the session goal as active. */
    set(text: string): GoalRecord;
    get(): GoalRecord | undefined;
    isActive(): boolean;
    /** Append a progress note to the active goal's timeline. */
    addNote(text: string): void;
    /** Mark the goal completed; an optional wrap-up note is recorded. */
    complete(summary?: string): void;
    /** Abandon the goal with an optional reason note. */
    cancel(reason?: string): void;
    clear(): void;
    /**
     * Render the goal as a context block for system-prompt injection.
     * Returns '' when no goal has ever been set.
     */
    promptBlock(): string;
    /** The goal block as a history message, or undefined when there is no goal. */
    buildMessage(role?: 'user' | 'system'): CompactMessage | undefined;
    /** Serialize for the host's session log. */
    toJSON(): string | undefined;
    /** Restore from `toJSON()` output. */
    static fromJSON(json: string | undefined, marker?: string): GoalManager;
}
//# sourceMappingURL=goal.d.ts.map
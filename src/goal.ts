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

/** Progress notes rendered into the prompt block, most recent kept. */
const MAX_PROMPT_NOTES = 5;

export class GoalManager {
  /** Stable prefix identifying goal reminder messages in the history. */
  readonly marker: string;
  private record?: GoalRecord;

  constructor(marker = '[active goal]') {
    this.marker = marker;
  }

  /** Set (or replace) the session goal as active. */
  set(text: string): GoalRecord {
    const now = new Date().toISOString();
    this.record = { text, status: 'active', notes: [], createdAt: now, updatedAt: now };
    return { ...this.record, notes: [] };
  }

  get(): GoalRecord | undefined {
    return this.record ? { ...this.record, notes: [...this.record.notes] } : undefined;
  }

  isActive(): boolean {
    return this.record?.status === 'active';
  }

  /** Append a progress note to the active goal's timeline. */
  addNote(text: string): void {
    if (!this.record) throw new Error('addNote() called without an active goal.');
    this.record.notes.push({ text, at: new Date().toISOString() });
    this.record.updatedAt = new Date().toISOString();
  }

  /** Mark the goal completed; an optional wrap-up note is recorded. */
  complete(summary?: string): void {
    if (!this.record) throw new Error('complete() called without an active goal.');
    if (summary) this.record.notes.push({ text: summary, at: new Date().toISOString() });
    this.record.status = 'completed';
    this.record.updatedAt = new Date().toISOString();
  }

  /** Abandon the goal with an optional reason note. */
  cancel(reason?: string): void {
    if (!this.record) throw new Error('cancel() called without an active goal.');
    if (reason) this.record.notes.push({ text: reason, at: new Date().toISOString() });
    this.record.status = 'cancelled';
    this.record.updatedAt = new Date().toISOString();
  }

  clear(): void {
    this.record = undefined;
  }

  /**
   * Render the goal as a context block for system-prompt injection.
   * Returns '' when no goal has ever been set.
   */
  promptBlock(): string {
    if (!this.record) return '';
    const lines = [this.marker, `Goal: ${this.record.text}`, `Status: ${this.record.status}`];
    if (this.record.notes.length > 0) {
      lines.push('Recent progress:');
      for (const note of this.record.notes.slice(-MAX_PROMPT_NOTES)) {
        lines.push(`- ${note.text}`);
      }
    }
    return lines.join('\n');
  }

  /** The goal block as a history message, or undefined when there is no goal. */
  buildMessage(role: 'user' | 'system' = 'user'): CompactMessage | undefined {
    if (!this.record) return undefined;
    return { role, content: this.promptBlock() };
  }

  /** Serialize for the host's session log. */
  toJSON(): string | undefined {
    return this.record ? JSON.stringify(this.record) : undefined;
  }

  /** Restore from `toJSON()` output. */
  static fromJSON(json: string | undefined, marker = '[active goal]'): GoalManager {
    const manager = new GoalManager(marker);
    if (json) {
      manager.record = JSON.parse(json) as GoalRecord;
    }
    return manager;
  }
}

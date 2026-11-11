/**
 * Compaction-turn prompts and message serialization.
 *
 * The compaction turn is a dedicated LLM call whose only job is to produce a
 * handoff summary — it never executes the task itself.
 */

import type { CompactMessage, SummaryRequest } from './types.js';

export const COMPACTION_SYSTEM_PROMPT = [
  'You are a context-compaction assistant for an autonomous agent session.',
  'You will receive a verbatim transcript of the older part of a conversation.',
  'Produce a handoff summary that lets a fresh agent instance continue the work without losing critical context.',
  'Rules:',
  '- Keep what is needed to continue: goals, decisions, file paths, commands, errors, constraints, and user preferences.',
  '- Drop pleasantries, redundant tool output, and superseded attempts. Compress; do not editorialize.',
  '- Do not invent facts that are not in the transcript.',
  '- Write the summary in the same language as the majority of the conversation.',
  '- Output ONLY the summary in Markdown, using the exact section structure requested in the user message.',
].join('\n');

/** Per-message content cap when serializing the transcript into the prompt. */
const DEFAULT_ITEM_CHAR_LIMIT = 4_000;
/** Tool results are usually noisier — cap them harder. */
const TOOL_RESULT_CHAR_LIMIT = 1_500;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…[truncated]`;
}

function contentToText(content: CompactMessage['content']): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  return JSON.stringify(content);
}

/**
 * Serialize the old part of the conversation into an indexed transcript for
 * the summarizer. Long messages and tool results are truncated with a marker.
 */
export function serializeForSummary(
  messages: readonly CompactMessage[],
  itemCharLimit = DEFAULT_ITEM_CHAR_LIMIT,
): string {
  const lines: string[] = [];
  messages.forEach((message, i) => {
    const role = message.role.toUpperCase();
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const calls = message.tool_calls
        .map((c) => `${c.function.name}(${c.function.arguments})`)
        .join('; ');
      const text = contentToText(message.content);
      lines.push(`[#${i}] ASSISTANT tool_calls: ${truncate(calls, itemCharLimit)}`);
      if (text) lines.push(`[#${i}] ASSISTANT text: ${truncate(text, itemCharLimit)}`);
      return;
    }
    const body =
      message.role === 'tool'
        ? truncate(contentToText(message.content), TOOL_RESULT_CHAR_LIMIT)
        : truncate(contentToText(message.content), itemCharLimit);
    lines.push(`[#${i}] ${role}: ${body}`);
  });
  return lines.join('\n\n');
}

const SECTION_SKELETON = [
  '## Goal',
  '## Done',
  '## Decisions',
  '## State', // files, environment, key data produced so far
  '## Next steps',
  '## Caveats', // errors hit, constraints, risks
].join('\n');

/** Build the user message of the compaction turn. */
export function buildCompactionUserPrompt(request: SummaryRequest): string {
  const parts: string[] = [
    'Summarize the following conversation transcript into a handoff summary.',
    '',
    '<transcript>',
    serializeForSummary(request.messages),
    '</transcript>',
  ];

  if (request.previousSummary) {
    parts.push(
      '',
      'This conversation was compacted before. The summary from the earlier compaction follows — merge it into the sections below (it describes even older history):',
      '<previous_summary>',
      request.previousSummary,
      '</previous_summary>',
    );
  }

  if (request.activeGoal) {
    parts.push(
      '',
      'The session has a standing goal (below). The handoff summary must keep the next agent aligned with it:',
      '<active_goal>',
      request.activeGoal,
      '</active_goal>',
    );
  }

  if (request.focus) {
    parts.push('', `Pay special attention to this emphasis from the user: ${request.focus}`);
  }

  parts.push(
    '',
    'Write the handoff summary in Markdown with EXACTLY these sections (omit a section only if truly nothing applies):',
    SECTION_SKELETON,
  );
  return parts.join('\n');
}

/**
 * Mechanical fallback summary used when the LLM call fails. It keeps the
 * structure of a real summary and never interrupts the session.
 */
export function buildFallbackSummary(request: SummaryRequest, maxItems = 10): string {
  const { messages, previousSummary, activeGoal } = request;
  const parts: string[] = [
    '## Note',
    'This summary was produced by the mechanical fallback (the summarization LLM was unavailable). Older messages were dropped without semantic compression.',
  ];

  if (activeGoal) {
    parts.push('', '## Standing goal', activeGoal);
  }

  if (previousSummary) {
    parts.push('', '## Earlier summary (retained from previous compaction)', previousSummary);
  }

  const userRequests = messages
    .filter((m) => m.role === 'user')
    .map((m) => contentToText(m.content).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-maxItems);
  if (userRequests.length > 0) {
    parts.push(
      '',
      '## Recent user requests',
      ...userRequests.map((r) => `- ${truncate(r, 200)}`),
    );
  }

  const assistantNotes = messages
    .filter((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim())
    .map((m) => (m.content as string).replace(/\s+/g, ' ').trim())
    .slice(-maxItems);
  if (assistantNotes.length > 0) {
    parts.push('', '## Last assistant statements', ...assistantNotes.map((a) => `- ${truncate(a, 200)}`));
  }

  return parts.join('\n');
}

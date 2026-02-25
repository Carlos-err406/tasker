import type { Task } from '@tasker/core/types';
import { getDisplayDescription, sampleRandom } from '@tasker/core';

/**
 * Build the system prompt with optional task context from the same list.
 * Selects up to 20 random tasks and includes their full descriptions.
 */
export function buildSystemPrompt(siblingTasks: Task[]): string {
  let context = '';

  if (siblingTasks.length > 0) {
    const sampled = sampleRandom(siblingTasks, 20);
    const descriptions = sampled
      .map((t) => getDisplayDescription(t.description))
      .filter((d) => d.length > 0);

    if (descriptions.length > 0) {
      context = `---
Existing tasks in this list (for context only — match their style and domain):
${descriptions.map((d) => `* ${d}`).join('\n----end of task----\n')}
---`;
    }
  }

  return `You autocomplete task descriptions. The user's input has a caret marked by <|caret|>. Output ONLY the text to insert at the caret position. No explanation, no quotes. If the input is already complete, output nothing.

Task descriptions support GitHub Flavored Markdown (GFM): **bold**, *italic*, \`code\`, [links](url), ![images](url), - [ ] checklists, etc.${context}`;
}

/**
 * Prepare the user's text for the completion request.
 * Strips metadata lines (using core's getDisplayDescription) and inserts a caret marker.
 */
export function prepareCompletionText(text: string, caretOffset: number): string {
  const beforeCaret = text.slice(0, caretOffset);
  const afterCaret = text.slice(caretOffset);
  const cleaned = getDisplayDescription(beforeCaret + '<|caret|>' + afterCaret);
  return cleaned;
}

/**
 * Build the messages array for the completion request.
 * Uses few-shot examples so the model understands the expected output format,
 * then the actual partial text as the final user message.
 */
export function buildCompleteMessages(
  text: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return [
    { role: 'user', content: 'Buy groc<|caret|>' },
    { role: 'assistant', content: 'eries and milk' },
    { role: 'user', content: 'Fix the login<|caret|>' },
    { role: 'assistant', content: 'page redirect bug' },
    { role: 'user', content: 'Review PR for<|caret|>' },
    { role: 'assistant', content: 'user settings refactor' },
    { role: 'user', content: text },
  ];
}

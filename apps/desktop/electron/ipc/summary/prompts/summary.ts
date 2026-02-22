import type { Task } from '@tasker/core/types';
import { TaskStatus } from '@tasker/core/types';

export function buildSummaryPrompt(tasks: Task[], listName: string, timeRange: string): string {
  const done = tasks.filter((t) => t.status === TaskStatus.Done);
  const inProgress = tasks.filter((t) => t.status === TaskStatus.InProgress);
  const pending = tasks.filter((t) => t.status === TaskStatus.Pending);

  const rangeLabel =
    timeRange === 'today' ? 'today' :
    timeRange === '7d'    ? 'the last 7 days' :
    timeRange === '30d'   ? 'the last 30 days' :
                            'all time';

  const formatList = (items: Task[]) =>
    items.map((t) => `- ${t.description.split('\n')[0]}`).join('\n');

  const sections: string[] = [];

  if (done.length > 0) {
    sections.push(`Completed (${done.length}):\n${formatList(done)}`);
  }
  if (inProgress.length > 0) {
    sections.push(`In progress (${inProgress.length}):\n${formatList(inProgress)}`);
  }
  if (pending.length > 0) {
    sections.push(`Pending (${pending.length}):\n${formatList(pending)}`);
  }

  const taskData = sections.length > 0 ? sections.join('\n\n') : '(no tasks)';

  return `Generate a concise status report for the "${listName}" list covering ${rangeLabel}.

Task data:
${taskData}

Write a rich markdown summary. Include:
- A brief executive summary paragraph
- A section for completed work (## Done) with key accomplishments bolded
- A section for current work (## In Progress) if any
- A section for upcoming work (## Pending) highlighting high-priority items
- A brief stats line at the end (e.g. "3 done · 2 in progress · 5 pending")

Use markdown formatting: headers (##), bold (**text**), and bullet lists (-).
Keep it informative but concise. Omit sections that have no tasks.`;
}

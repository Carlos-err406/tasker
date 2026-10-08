import type { Task } from '@tasker/core/types';
import { TaskStatus, Priority, PriorityName } from '@tasker/core/types';
import { getDisplayDescription } from '@tasker/core/parsers';

/** First line of the display description (title). */
export function getDisplayTitle(task: Task): string {
  return getDisplayDescription(task.description).split('\n')[0]!;
}

/** Lines after the title (description preview), preserving original line breaks. Null if single-line. */
export function getDescriptionPreview(task: Task): string | null {
  const display = getDisplayDescription(task.description);
  const lines = display.split('\n');
  if (lines.length <= 1) return null;
  const rest = lines.slice(1);
  // Trim leading/trailing blank lines but preserve internal ones for markdown
  let start = 0;
  while (start < rest.length && rest[start]!.trim() === '') start++;
  let end = rest.length - 1;
  while (end >= start && rest[end]!.trim() === '') end--;
  if (start > end) return null;
  const preview = rest.slice(start, end + 1).join('\n');
  return preview || null;
}

export function getShortId(task: Task): string {
  return task.id.slice(0, 3);
}

export function isPending(task: Task): boolean {
  return task.status === TaskStatus.Pending;
}

export function isInProgress(task: Task): boolean {
  return task.status === TaskStatus.InProgress;
}

export function isDone(task: Task): boolean {
  return task.status === TaskStatus.Done;
}

export function isWontDo(task: Task): boolean {
  return task.status === TaskStatus.WontDo;
}

export function getPriorityLabel(priority: number | null): string | null {
  if (priority === null) return null;
  return PriorityName[priority as keyof typeof PriorityName] ?? null;
}

export function getPriorityIndicator(priority: number | null): string | null {
  switch (priority) {
    case Priority.High:
      return '>>>';
    case Priority.Medium:
      return '>>';
    case Priority.Low:
      return '>';
    default:
      return null;
  }
}

export function getPriorityColor(priority: number | null): string {
  switch (priority) {
    case Priority.High:
      return 'text-red-500';
    case Priority.Medium:
      return 'text-orange-400';
    case Priority.Low:
      return 'text-blue-400';
    default:
      return '';
  }
}

export function getDueDateColor(dueDate: string | null): string {
  if (!dueDate) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00');

  if (due < today) return 'text-red-500'; // overdue
  if (due.getTime() === today.getTime()) return 'text-orange-400'; // today
  return 'text-muted-foreground';
}

export function formatDueDate(dueDate: string | null): string | null {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00');
  const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff <= 7) return `in ${diff}d`;
  return dueDate;
}

/** Status label for linked tasks (relationship lines). Null for pending. */
export function getLinkedStatusLabel(status: number): string | null {
  switch (status) {
    case TaskStatus.Done: return 'Done';
    case TaskStatus.InProgress: return 'In Progress';
    case TaskStatus.WontDo: return "Won't Do";
    default: return null;
  }
}

/** Tailwind color class for linked task status badge. */
export function getLinkedStatusColor(status: number): string {
  switch (status) {
    case TaskStatus.Done: return 'text-green-400';
    case TaskStatus.InProgress: return 'text-amber-400';
    case TaskStatus.WontDo: return 'text-zinc-400';
    default: return '';
  }
}

// Deterministic color for tags (same tag always gets same color).
// Literal class strings so Tailwind generates every color.
export const TAG_COLORS = [
  'bg-red-500/20 text-red-700 dark:text-red-300',
  'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
  'bg-lime-500/20 text-lime-700 dark:text-lime-300',
  'bg-green-500/20 text-green-700 dark:text-green-300',
  'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  'bg-teal-500/20 text-teal-700 dark:text-teal-300',
  'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
  'bg-sky-500/20 text-sky-700 dark:text-sky-300',
  'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300',
  'bg-violet-500/20 text-violet-700 dark:text-violet-300',
  'bg-purple-500/20 text-purple-700 dark:text-purple-300',
  'bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300',
  'bg-pink-500/20 text-pink-700 dark:text-pink-300',
  'bg-rose-500/20 text-rose-700 dark:text-rose-300',
];

// FNV-1a with a murmur3 finalizer. A plain `* 31` hash keeps only an
// alternating character sum modulo a power of two, so most tags shared a
// handful of colors. The seed is arbitrary; this one spreads common tags well.
export function getTagColor(tag: string): string {
  let hash = 0x811ca111;
  for (let i = 0; i < tag.length; i++) {
    hash ^= tag.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return TAG_COLORS[(hash >>> 0) % TAG_COLORS.length]!;
}

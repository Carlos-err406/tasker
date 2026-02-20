import type { Task } from '@tasker/core';

/** Returns true if the input value is in command mode (starts with '>') */
export function isCommandMode(inputValue: string): boolean {
  return inputValue.startsWith('>');
}

/** Strips the '>' prefix and leading space to get the actual query */
export function getCommandQuery(inputValue: string): string {
  return inputValue.startsWith('>') ? inputValue.slice(1).trimStart() : inputValue;
}

/** Filters tasks by matching query against description or id */
export function filterTasks(tasks: Task[], query: string): Task[] {
  if (!query.trim()) return tasks;
  const q = query.trim().toLowerCase();
  return tasks.filter(
    (t) => t.description.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
  );
}

/** Filters items with a label field by matching query against label */
export function filterByLabel<T extends { label: string }>(items: T[], query: string): T[] {
  if (!query.trim()) return items;
  const q = query.trim().toLowerCase();
  return items.filter((item) => item.label.toLowerCase().includes(q));
}

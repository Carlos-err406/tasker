/**
 * `>list-name` metadata: create a task in, or move it to, another list.
 * The token is one-shot: it is resolved here and stripped from the saved text.
 */
import type { TaskerDb } from '../db.js';
import { parse, listTargetKey, stripListTarget } from '../parsers/task-description-parser.js';
import { getAllListNames } from './list-queries.js';

/** Resolve a `>token` to an existing list: exact name first, then case-, space-,
 *  hyphen- and underscore-insensitive. */
export function resolveListTarget(db: TaskerDb, target: string): string | null {
  const lists = getAllListNames(db);
  if (lists.includes(target)) return target;
  const key = listTargetKey(target);
  return lists.find((name) => listTargetKey(name) === key) ?? null;
}

/** Split a description into its text without `>list` and the list it should live in. */
export function takeListTarget(
  db: TaskerDb,
  description: string,
  currentList: string,
): { description: string; listName: string } {
  const target = parse(description).listTarget;
  if (!target) return { description, listName: currentList };
  const listName = resolveListTarget(db, target);
  if (!listName) throw new Error(`No list matches ">${target}"`);
  return { description: stripListTarget(description), listName };
}

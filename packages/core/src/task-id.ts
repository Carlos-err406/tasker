/**
 * Task ID format: `tsk_` followed by 5 lowercase base-36 characters (e.g. `tsk_k3x9q`).
 * The prefix keeps short words an agent or user sends (like `lol`) from reading as IDs.
 * Pure, with no Node.js imports, so every host shares it.
 */

export const TASK_ID_PREFIX = 'tsk_';
const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const SUFFIX_LENGTH = 5;
/** Number of distinct task IDs. */
export const TASK_ID_SPACE = ID_CHARS.length ** SUFFIX_LENGTH;
/** Regex source for one task ID, for embedding in larger patterns. */
export const TASK_ID_PATTERN = `${TASK_ID_PREFIX}[a-z0-9]{${SUFFIX_LENGTH}}`;
const TASK_ID_RE = new RegExp(`^${TASK_ID_PATTERN}$`);
/** IDs before 1.4.0: 3 lowercase base-36 characters. */
const LEGACY_TASK_ID_RE = /^[a-z0-9]{3}$/;

export function isTaskId(value: unknown): value is string {
  return typeof value === 'string' && TASK_ID_RE.test(value);
}

export function isLegacyTaskId(value: unknown): value is string {
  return typeof value === 'string' && LEGACY_TASK_ID_RE.test(value);
}

/** Generate a random task ID */
export function generateId(): string {
  let id = TASK_ID_PREFIX;
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return id;
}

/** The task ID for slot `n` of the ID space, used to resolve sync collisions deterministically. */
export function taskIdAt(n: number): string {
  return TASK_ID_PREFIX + (n % TASK_ID_SPACE).toString(36).padStart(SUFFIX_LENGTH, '0');
}

/**
 * The new ID for a pre-1.4.0 task: its old 3 characters plus 2 derived from its
 * creation time. Deterministic, so every device migrates a task to the same ID
 * without coordinating, and old IDs stay recognizable (`9kf` → `tsk_9kf..`).
 */
export function migrateLegacyTaskId(legacyId: string, createdAt: string): string {
  let n = 0;
  for (const c of legacyId + ':' + createdAt) n = (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0;
  return TASK_ID_PREFIX + legacyId + (n % ID_CHARS.length ** 2).toString(36).padStart(2, '0');
}

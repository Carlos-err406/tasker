// Types
export { TaskStatus, TaskStatusName } from './types/task-status.js';
export { Priority, PriorityName } from './types/priority.js';
export type { TaskId, ListName, Task } from './types/task.js';
export type { TaskResult, DataResult, BatchResult } from './types/results.js';
export { isSuccess, isError, successCount, anyFailed } from './types/results.js';

// Schema
export * from './schema/index.js';

// Database (portable — no Node.js imports)
export type { TaskerDb } from './db.js';
export { CREATE_SCHEMA_SQL } from './db.js';

// Database (Node.js — re-exported for backward compatibility)
// Mobile should import from @tasker/core/db-node or avoid these entirely.
export { createDb, createTestDb, getDefaultDbPath, getDbPath, getRawDb, withRetry } from './db-node.js';

// Parsers
export { parseDate, parseTaskDescription, getDisplayDescription, syncMetadataToDescription } from './parsers/index.js';
export type { ParsedTask } from './parsers/index.js';

// Queries
export * from './queries/index.js';
export { reminderFor, dueReminders, DEFAULT_REMINDER_TIME, MAX_LATENESS_MS } from './reminders.js';
export type { Reminder } from './reminders.js';

// Undo
export { UndoManager, getCommandDescription } from './undo/index.js';
export type { UndoCommand } from './undo/index.js';

// Utils
export { sampleRandom } from './utils/index.js';

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

// Undo
export { UndoManager, getCommandDescription } from './undo/index.js';
export type { UndoCommand } from './undo/index.js';

// Backup (Node.js only — available via @tasker/core or @tasker/core/backup)
export { BackupManager } from './backup/index.js';
export type { BackupInfo } from './backup/index.js';

// Utils
export { sampleRandom } from './utils/index.js';

// AI
// Note: AI module is available via @tasker/core/ai subpath export only.
// Do NOT re-export here — AI packages (Vercel AI SDK, LM Studio client)
// use Node.js APIs and must not be bundled into the Electron renderer.

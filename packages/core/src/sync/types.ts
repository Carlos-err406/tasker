/** Portable sync data. No credentials, device settings, undo history, or image bytes. */
export interface Revision {
  time: number;
  counter: number;
  actor: string;
}
export interface SyncList {
  name: string;
  sortOrder: number;
}
export interface SyncTask {
  preferredId: string;
  description: string;
  createdAt: string;
  status: number;
  listId: string;
  dueDate: string | null;
  priority: number | null;
  tags: string[] | null;
  isTrashed: number;
  sortOrder: number;
  completedAt: string | null;
  parentId: string | null;
}
export interface SyncEdge {
  from: string;
  to: string;
}
export interface SyncValues {
  list: SyncList;
  task: SyncTask;
  dependency: SyncEdge;
  relation: SyncEdge;
}
export type SyncKind = keyof SyncValues;
export type SyncRecord = {
  [K in SyncKind]: {
    kind: K;
    id: string;
    revision: Revision;
    value: SyncValues[K] | null;
  };
}[SyncKind];
export interface SyncImage {
  id: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
}
/** Format 2 (1.4.0) changed task IDs to `tsk_abcde`; format 1 checkpoints are upgraded on read. */
export const CHECKPOINT_FORMAT = 2;
export interface Checkpoint {
  format: typeof CHECKPOINT_FORMAT;
  replica: string;
  sequence: number;
  records: SyncRecord[];
  images: SyncImage[];
}
export const DEFAULT_LIST_ID = "legacy:list:tasks";
export const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;
export const MAX_SYNC_IMAGE_BYTES = 10 * 1024 * 1024;

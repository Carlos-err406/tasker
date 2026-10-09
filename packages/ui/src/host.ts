import type { tasksInvokerFactory } from './transport/tasks/preload.js';
import type { listsInvokerFactory } from './transport/lists/preload.js';
import type { undoInvokerFactory } from './transport/undo/preload.js';
import type { settingsInvokerFactory } from './transport/settings/preload.js';
export type Operations = ReturnType<typeof tasksInvokerFactory> & ReturnType<typeof listsInvokerFactory> & ReturnType<typeof undoInvokerFactory> & ReturnType<typeof settingsInvokerFactory>;
export interface Host {
  /** Enables explicit editor actions for a touch-only host. */
  touch?: boolean;
  /** The host can show due-time notifications, so Settings offers the switch. */
  notifications?: boolean;
  operations: Operations;
  onDbChanged(callback: () => void): () => void;
  onPopupShown(callback: () => void): () => void;
  onPopupHidden(callback: () => void): () => void;
  openExternal(url: string): Promise<void>;
  saveImage(file: File): Promise<string>;
  resolveMedia(src: string): string;
}
let host: Host | undefined;
export function configureHost(value: Host) { host = value; }
export function getHost(): Host { if (!host) throw new Error('Tasker UI host is not configured'); return host; }

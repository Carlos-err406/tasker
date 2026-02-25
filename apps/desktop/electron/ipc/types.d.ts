import type { BrowserWindow } from 'electron';
import type { TaskerDb, UndoManager } from '@tasker/core';
import type { tasksInvokerFactory } from './tasks/preload.js';
import type { listsInvokerFactory } from './lists/preload.js';
import type { undoInvokerFactory } from './undo/preload.js';
import type { windowInvokerFactory } from './window/preload.js';
import type { reminderInvokerFactory } from './reminder/preload.js';
import type { logsInvokerFactory } from './logs/preload.js';
import type { clipboardInvokerFactory } from './clipboard/preload.js';
import type { decomposeInvokerFactory } from './decompose/preload.js';
import type { summaryInvokerFactory } from './summary/preload.js';
import type { aiCompleteInvokerFactory } from './ai-complete/preload.js';
import type { LogEntry } from '../lib/log-buffer.js';

export interface IPCContext {
  db: TaskerDb;
  undo: UndoManager;
}

export type IPCRegisterFunction = (
  ipcMain: Electron.IpcMain,
  widget: BrowserWindow | null,
  ctx: IPCContext,
) => void;

export type IPC = ReturnType<typeof tasksInvokerFactory> &
  ReturnType<typeof listsInvokerFactory> &
  ReturnType<typeof undoInvokerFactory> &
  ReturnType<typeof windowInvokerFactory> &
  ReturnType<typeof reminderInvokerFactory> &
  ReturnType<typeof logsInvokerFactory> &
  ReturnType<typeof clipboardInvokerFactory> &
  ReturnType<typeof decomposeInvokerFactory> &
  ReturnType<typeof summaryInvokerFactory> &
  ReturnType<typeof aiCompleteInvokerFactory> & {
    homePath: string;
    onLogEntry: (callback: (entry: LogEntry) => void) => () => void;
    onDbChanged: (callback: () => void) => () => void;
    onPopupHidden: (callback: () => void) => () => void;
    onPopupShown: (callback: () => void) => () => void;
    onSetSearch: (callback: (query: string) => void) => () => void;
    'tasker:resetForTest': () => Promise<void>;
  };

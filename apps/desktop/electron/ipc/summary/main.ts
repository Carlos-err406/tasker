import { getAllTasks } from '@tasker/core';
import { TaskStatus } from '@tasker/core/types';
import { isLmStudioAvailable, createLmStudioProvider, createModel, streamWithCallbacks } from '@tasker/core/ai';
import { getPopupWindow } from '../../lib/tray.js';
import type { IPCRegisterFunction } from '../types.js';
import { buildSummaryPrompt } from './prompts/summary.js';
import {
  SUMMARY_AVAILABLE,
  SUMMARY_START,
  SUMMARY_ABORT,
  SUMMARY_CHUNK,
  SUMMARY_DONE,
  SUMMARY_ERROR,
} from './channels.js';

function getCutoffDate(timeRange: string): Date | null {
  const now = new Date();
  if (timeRange === 'today') return new Date(now.setHours(0, 0, 0, 0));
  if (timeRange === '7d')    return new Date(Date.now() - 7 * 86400000);
  if (timeRange === '30d')   return new Date(Date.now() - 30 * 86400000);
  return null; // 'all'
}

export const summaryRegister: IPCRegisterFunction = (ipcMain, _widget, { db }) => {
  let currentController: AbortController | null = null;

  ipcMain.handle(SUMMARY_AVAILABLE, () => isLmStudioAvailable());

  ipcMain.handle(SUMMARY_ABORT, () => {
    currentController?.abort();
    currentController = null;
  });

  // Use a non-async handler that returns immediately — this sends the IPC reply
  // right away and avoids "reply was never sent" if the stream hangs or errors.
  // All data (chunks, done, error) is pushed via webContents.send.
  ipcMain.handle(SUMMARY_START, (_event, listName: string, timeRange: string) => {
    const send = (channel: string, ...args: unknown[]) => {
      const win = getPopupWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    };

    // Abort any existing in-flight stream before starting a new one.
    currentController?.abort();
    currentController = new AbortController();
    const { signal } = currentController;

    // Fire-and-forget: start streaming without blocking the IPC reply.
    (async () => {
      try {
        console.log('[summary] handler invoked for list', listName, 'range', timeRange);

        const allTasks = getAllTasks(db, listName);
        const cutoff = getCutoffDate(timeRange);

        const filtered = allTasks.filter((task) => {
          // Always include in-progress tasks
          if (task.status === TaskStatus.InProgress) return true;
          // For done tasks: filter by recency
          if (task.status === TaskStatus.Done) {
            if (!cutoff) return true;
            return new Date(task.createdAt) >= cutoff;
          }
          // For pending tasks: include high-priority (p1/p2) or overdue
          if (task.status === TaskStatus.Pending) {
            if (!cutoff) return true;
            const isHighPriority = task.priority !== null && task.priority <= 2;
            const isOverdue = task.dueDate !== null && new Date(task.dueDate) < new Date();
            return isHighPriority || isOverdue;
          }
          return true;
        });

        const prompt = buildSummaryPrompt(filtered, listName, timeRange);

        console.log('[summary] creating provider and model');
        const provider = createLmStudioProvider();
        const model = createModel(provider, 'default');

        console.log('[summary] starting stream');
        await streamWithCallbacks(model, prompt, {
          onChunk: (text) => send(SUMMARY_CHUNK, text),
          onError: (error) => {
            if (signal.aborted) return; // User cancelled — suppress error
            console.error('[summary] stream error:', error);
            send(SUMMARY_ERROR, error.message);
          },
          onFinish: () => {
            if (signal.aborted) return;
            console.log('[summary] stream finished');
            send(SUMMARY_DONE);
          },
        }, { signal });
        console.log('[summary] streamWithCallbacks resolved');
      } catch (err) {
        if (signal.aborted) return;
        console.error('[summary] caught error:', err);
        const message = err instanceof Error ? err.message : String(err);
        send(SUMMARY_ERROR, message);
      }
    })();
    // Return undefined synchronously — IPC reply is sent immediately.
  });
};

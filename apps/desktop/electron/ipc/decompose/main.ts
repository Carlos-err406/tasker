import { getTaskById, getSubtasks } from '@tasker/core';
import { isLmStudioAvailable, createLmStudioProvider, createModel, streamWithCallbacks } from '@tasker/core/ai';
import { getPopupWindow } from '../../lib/tray.js';
import type { IPCRegisterFunction } from '../types.js';
import { buildDecomposePrompt } from './prompts/decompose.js';
import {
  DECOMPOSE_AVAILABLE,
  DECOMPOSE_START,
  DECOMPOSE_ABORT,
  DECOMPOSE_CHUNK,
  DECOMPOSE_DONE,
  DECOMPOSE_ERROR,
} from './channels.js';

export const decomposeRegister: IPCRegisterFunction = (ipcMain, _widget, { db }) => {
  let currentController: AbortController | null = null;

  ipcMain.handle(DECOMPOSE_AVAILABLE, () => isLmStudioAvailable());

  ipcMain.handle(DECOMPOSE_ABORT, () => {
    currentController?.abort();
    currentController = null;
  });

  // Use a non-async handler that returns immediately — this sends the IPC reply
  // right away and avoids "reply was never sent" if the stream hangs or errors.
  // All data (chunks, done, error) is pushed via webContents.send.
  ipcMain.handle(DECOMPOSE_START, (_event, taskId: string) => {
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
        console.log('[decompose] handler invoked for task', taskId);

        const task = getTaskById(db, taskId);
        if (!task) {
          console.error('[decompose] task not found:', taskId);
          send(DECOMPOSE_ERROR, `Task ${taskId} not found`);
          return;
        }

        const existingSubtasks = getSubtasks(db, taskId);
        const prompt = buildDecomposePrompt(
          task.description,
          existingSubtasks.map((s) => s.description),
        );

        console.log('[decompose] creating provider and model');
        const provider = createLmStudioProvider();
        const model = createModel(provider, 'default');

        console.log('[decompose] starting stream');
        await streamWithCallbacks(model, prompt, {
          onChunk: (text) => send(DECOMPOSE_CHUNK, text),
          onError: (error) => {
            if (signal.aborted) return; // User cancelled — suppress error
            console.error('[decompose] stream error:', error);
            send(DECOMPOSE_ERROR, error.message);
          },
          onFinish: () => {
            if (signal.aborted) return;
            console.log('[decompose] stream finished');
            send(DECOMPOSE_DONE);
          },
        }, { signal });
        console.log('[decompose] streamWithCallbacks resolved');
      } catch (err) {
        if (signal.aborted) return;
        console.error('[decompose] caught error:', err);
        const message = err instanceof Error ? err.message : String(err);
        send(DECOMPOSE_ERROR, message);
      }
    })();
    // Return undefined synchronously — IPC reply is sent immediately.
  });
};

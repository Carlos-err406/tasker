import type { BrowserWindow } from 'electron';
import type { IPCContext } from './types.js';
import { tasksRegister } from './tasks/main.js';
import { listsRegister } from './lists/main.js';
import { undoRegister } from './undo/main.js';
import { windowRegister } from './window/main.js';
import { reminderRegister } from './reminder/main.js';
import { logsRegister } from './logs/main.js';
import { clipboardRegister } from './clipboard/main.js';
import { decomposeRegister } from './decompose/main.js';
import { summaryRegister } from './summary/main.js';

export default function registerIPCs(
  ipcMain: Electron.IpcMain,
  widget: BrowserWindow | null,
  ctx: IPCContext,
): void {
  [tasksRegister, listsRegister, undoRegister, windowRegister, reminderRegister, logsRegister, clipboardRegister, decomposeRegister, summaryRegister].forEach(
    (fn) => fn(ipcMain, widget, ctx),
  );
}

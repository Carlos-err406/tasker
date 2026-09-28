import $try from "../try.js";
import type { IPCRegisterFunction } from "../registry.js";
import {
  UNDO_UNDO,
  UNDO_REDO,
  UNDO_CAN_UNDO,
  UNDO_CAN_REDO,
  UNDO_RELOAD,
} from "./undo-channels.js";

export const undoRegister: IPCRegisterFunction = (
  ipcMain,
  _widget,
  { undo },
) => {
  ipcMain.handle(UNDO_UNDO, () => {
    return $try(() => undo.undo());
  });

  ipcMain.handle(UNDO_REDO, () => {
    return $try(() => undo.redo());
  });

  ipcMain.handle(UNDO_CAN_UNDO, () => {
    return $try(() => undo.canUndo);
  });

  ipcMain.handle(UNDO_CAN_REDO, () => {
    return $try(() => undo.canRedo);
  });

  ipcMain.handle(UNDO_RELOAD, () => {
    return $try(() => undo.reloadHistory());
  });
};

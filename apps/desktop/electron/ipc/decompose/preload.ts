import {
  DECOMPOSE_AVAILABLE,
  DECOMPOSE_START,
  DECOMPOSE_ABORT,
  DECOMPOSE_CHUNK,
  DECOMPOSE_DONE,
  DECOMPOSE_ERROR,
} from './channels.js';

export const decomposeInvokerFactory = (ipcRenderer: Electron.IpcRenderer) => ({
  [DECOMPOSE_AVAILABLE]: () => ipcRenderer.invoke(DECOMPOSE_AVAILABLE) as Promise<boolean>,

  [DECOMPOSE_START]: (taskId: string) =>
    ipcRenderer.invoke(DECOMPOSE_START, taskId) as Promise<void>,

  [DECOMPOSE_ABORT]: () => ipcRenderer.invoke(DECOMPOSE_ABORT) as Promise<void>,

  onDecomposeChunk: (callback: (chunk: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: string) => callback(chunk);
    ipcRenderer.on(DECOMPOSE_CHUNK, handler);
    return () => ipcRenderer.removeListener(DECOMPOSE_CHUNK, handler);
  },

  onDecomposeDone: (callback: () => void) => {
    ipcRenderer.on(DECOMPOSE_DONE, callback);
    return () => ipcRenderer.removeListener(DECOMPOSE_DONE, callback);
  },

  onDecomposeError: (callback: (message: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on(DECOMPOSE_ERROR, handler);
    return () => ipcRenderer.removeListener(DECOMPOSE_ERROR, handler);
  },
});

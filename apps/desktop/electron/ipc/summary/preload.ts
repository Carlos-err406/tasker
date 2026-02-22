import {
  SUMMARY_AVAILABLE,
  SUMMARY_START,
  SUMMARY_ABORT,
  SUMMARY_CHUNK,
  SUMMARY_DONE,
  SUMMARY_ERROR,
} from './channels.js';

export const summaryInvokerFactory = (ipcRenderer: Electron.IpcRenderer) => ({
  [SUMMARY_AVAILABLE]: () => ipcRenderer.invoke(SUMMARY_AVAILABLE) as Promise<boolean>,

  [SUMMARY_START]: (listName: string, timeRange: string) =>
    ipcRenderer.invoke(SUMMARY_START, listName, timeRange) as Promise<void>,

  [SUMMARY_ABORT]: () => ipcRenderer.invoke(SUMMARY_ABORT) as Promise<void>,

  onSummaryChunk: (callback: (chunk: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: string) => callback(chunk);
    ipcRenderer.on(SUMMARY_CHUNK, handler);
    return () => ipcRenderer.removeListener(SUMMARY_CHUNK, handler);
  },

  onSummaryDone: (callback: () => void) => {
    ipcRenderer.on(SUMMARY_DONE, callback);
    return () => ipcRenderer.removeListener(SUMMARY_DONE, callback);
  },

  onSummaryError: (callback: (message: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on(SUMMARY_ERROR, handler);
    return () => ipcRenderer.removeListener(SUMMARY_ERROR, handler);
  },
});

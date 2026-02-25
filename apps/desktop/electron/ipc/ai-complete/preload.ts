import { AI_COMPLETE, AI_COMPLETE_ABORT } from './channels.js';

export const aiCompleteInvokerFactory = (ipcRenderer: Electron.IpcRenderer) => ({
  [AI_COMPLETE]: (text: string) => ipcRenderer.invoke(AI_COMPLETE, text) as Promise<string | null>,
  [AI_COMPLETE_ABORT]: () => ipcRenderer.invoke(AI_COMPLETE_ABORT) as Promise<void>,
});

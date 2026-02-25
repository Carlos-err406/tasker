import { AI_COMPLETE, AI_COMPLETE_ABORT, type AiCompleteRequest } from './channels.js';

export const aiCompleteInvokerFactory = (ipcRenderer: Electron.IpcRenderer) => ({
  [AI_COMPLETE]: (req: AiCompleteRequest) => ipcRenderer.invoke(AI_COMPLETE, req) as Promise<string | null>,
  [AI_COMPLETE_ABORT]: () => ipcRenderer.invoke(AI_COMPLETE_ABORT) as Promise<void>,
});

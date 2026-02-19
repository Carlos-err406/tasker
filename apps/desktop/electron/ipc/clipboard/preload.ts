import { CLIPBOARD_SAVE_IMAGE } from './channels.js';

export const clipboardInvokerFactory = (ipcRenderer: Electron.IpcRenderer) => ({
  [CLIPBOARD_SAVE_IMAGE]: (() => ipcRenderer.invoke(CLIPBOARD_SAVE_IMAGE)) as () => Promise<string | null>,
});

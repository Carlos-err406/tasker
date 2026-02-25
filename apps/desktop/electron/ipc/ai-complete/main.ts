import { createLmStudioProvider, createModel, generateMessages, DEFAULT_BASE_URL } from '@tasker/core/ai';
import type { IPCRegisterFunction } from '../types.js';
import { AI_COMPLETE, AI_COMPLETE_ABORT } from './channels.js';

export const aiCompleteRegister: IPCRegisterFunction = (ipcMain) => {
  let controller: AbortController | null = null;

  ipcMain.handle(AI_COMPLETE, async (_event, text: string): Promise<string | null> => {
    controller?.abort();
    controller = new AbortController();
    try {
      const baseURL = process.env['TASKER_LM_STUDIO_URL'] ?? DEFAULT_BASE_URL;
      const provider = createLmStudioProvider(baseURL);
      const model = createModel(provider, 'default');
      // Assistant-prefill: the model sees its own partial output and continues
      // naturally — word boundaries and spacing are handled implicitly.
      const result = await generateMessages(
        model,
        [
          { role: 'user', content: 'Continue this task description briefly (max 8 words):' },
          { role: 'assistant', content: text },
        ],
        { maxOutputTokens: 40, temperature: 0.3, signal: controller.signal },
      );
      return result.text || null;
    } catch (err) {
      if (controller?.signal.aborted) return null;
      console.error('[ai-complete]', err);
      return null;
    } finally {
      controller = null;
    }
  });

  ipcMain.handle(AI_COMPLETE_ABORT, () => {
    controller?.abort();
    controller = null;
  });
};

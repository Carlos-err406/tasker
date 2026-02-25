import { createLmStudioProvider, createModel, generateMessages, DEFAULT_BASE_URL } from '@tasker/core/ai';
import { getAllTasks } from '@tasker/core';
import $try from '@utils/try.js';
import type { IPCRegisterFunction } from '../types.js';
import { AI_COMPLETE, AI_COMPLETE_ABORT, type AiCompleteRequest } from './channels.js';
import { buildCompleteMessages, buildSystemPrompt, prepareCompletionText } from './prompts/complete.js';

export const aiCompleteRegister: IPCRegisterFunction = (ipcMain, _widget, ctx) => {
  let controller: AbortController | null = null;

  ipcMain.handle(AI_COMPLETE, async (_event, req: AiCompleteRequest): Promise<string | null> => {
    controller?.abort();
    controller = new AbortController();
    try {
      const baseURL = process.env['TASKER_LM_STUDIO_URL'] ?? DEFAULT_BASE_URL;
      const provider = createLmStudioProvider(baseURL);
      const model = createModel(provider, 'default');

      const [err, siblingTasks = []] = await $try(() => getAllTasks(ctx.db, req.listName));
      if (err) console.warn('[ai-complete] failed to fetch sibling tasks:', err.message);

      const system = buildSystemPrompt(siblingTasks);
      const prepared = prepareCompletionText(req.text, req.caretOffset);
      const messages = buildCompleteMessages(prepared);

      const result = await generateMessages(
        model,
        messages,
        {
          system,
          temperature: 0.3,
          signal: controller.signal,
          providerOptions: { openai: { reasoningEffort: 'none' } },
        },
      );

      return result.text?.trim() || null;
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

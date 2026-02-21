import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export const DEFAULT_BASE_URL = 'http://localhost:1234/v1';

/**
 * Check if LM Studio is reachable at the given base URL.
 * Returns true if the server responds, false on any error or timeout.
 */
export async function isLmStudioAvailable(baseURL = DEFAULT_BASE_URL): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${baseURL}/models`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export function createLmStudioProvider(baseURL = DEFAULT_BASE_URL) {
  return createOpenAICompatible({
    name: 'lm-studio',
    baseURL,
  });
}

export function createModel(
  provider: ReturnType<typeof createOpenAICompatible>,
  modelId: string,
): LanguageModel {
  return provider.chatModel(modelId);
}

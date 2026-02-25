import {
  generateText,
  streamText,
  Output,
  type LanguageModel,
  type GenerateTextResult,
  type StreamTextResult,
  type ToolSet,
  type ModelMessage,
} from 'ai';

export type GenerateOptions = {
  system?: string;
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Provider-specific options (e.g. { openai: { reasoningEffort: 'none' } }) */
  providerOptions?: Parameters<typeof generateText>[0]['providerOptions'];
};

type DefaultOutput = Output.Output<string, string>;

export async function generate(
  model: LanguageModel,
  prompt: string,
  options?: GenerateOptions,
): Promise<GenerateTextResult<ToolSet, DefaultOutput>> {
  const params: Parameters<typeof generateText>[0] = { model, prompt };
  if (options?.system) params.system = options.system;
  if (options?.maxOutputTokens) params.maxOutputTokens = options.maxOutputTokens;
  if (options?.temperature !== undefined) params.temperature = options.temperature;
  if (options?.signal) params.abortSignal = options.signal;
  return await generateText(params);
}

/** Generate using a messages array (supports assistant prefill for continuation). */
export async function generateMessages(
  model: LanguageModel,
  messages: ModelMessage[],
  options?: GenerateOptions,
): Promise<GenerateTextResult<ToolSet, DefaultOutput>> {
  const params: Parameters<typeof generateText>[0] = { model, messages };
  if (options?.system) params.system = options.system;
  if (options?.maxOutputTokens) params.maxOutputTokens = options.maxOutputTokens;
  if (options?.temperature !== undefined) params.temperature = options.temperature;
  if (options?.signal) params.abortSignal = options.signal;
  if (options?.providerOptions) params.providerOptions = options.providerOptions;
  return await generateText(params);
}

export function stream(
  model: LanguageModel,
  prompt: string,
  options?: GenerateOptions,
): StreamTextResult<ToolSet, DefaultOutput> {
  const params: Parameters<typeof streamText>[0] = { model, prompt };
  if (options?.system) params.system = options.system;
  if (options?.maxOutputTokens) params.maxOutputTokens = options.maxOutputTokens;
  if (options?.temperature !== undefined) params.temperature = options.temperature;
  return streamText(params);
}

export type StreamCallbacks = {
  onChunk?: (text: string) => void;
  onError?: (error: Error) => void;
  onFinish?: () => void;
};

/**
 * Streams text and pushes chunks/errors/completion via callbacks.
 *
 * AI SDK v6: streamText() returns a lazy StreamTextResult — the internal HTTP
 * request and stream processing only start when you consume a result property
 * (textStream, fullStream, text, etc.). Callbacks (onChunk, onError, onFinish)
 * fire during that consumption, so we must await result.text to drive the pipeline.
 *
 * result.text rejects if the stream errors AND onError is not registered, but
 * since we register onError, errors are routed there instead. We still .catch()
 * result.text as a final fallback in case of pre-stream errors (e.g. no model
 * loaded, HTTP 400) that the SDK doesn't route through onError.
 */
export function streamWithCallbacks(
  model: LanguageModel,
  prompt: string,
  callbacks: StreamCallbacks,
  options?: GenerateOptions,
): Promise<void> {
  return new Promise<void>((resolve) => {
    // Guard against double-resolve if both onError/onFinish and result.text fire.
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const params: Parameters<typeof streamText>[0] = {
      model,
      prompt,
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          callbacks.onChunk?.((chunk as { type: 'text-delta'; text: string }).text);
        }
      },
      onError: ({ error }) => {
        console.error('[streamWithCallbacks] onError fired:', error);
        const err = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(err);
        settle();
      },
      onFinish: () => {
        console.log('[streamWithCallbacks] onFinish fired');
        callbacks.onFinish?.();
        settle();
      },
    };
    if (options?.system) params.system = options.system;
    if (options?.maxOutputTokens) params.maxOutputTokens = options.maxOutputTokens;
    if (options?.temperature !== undefined) params.temperature = options.temperature;
    if (options?.signal) params.abortSignal = options.signal;

    try {
      console.log('[streamWithCallbacks] calling streamText');
      const result = streamText(params);
      console.log('[streamWithCallbacks] consuming result.text to drive the stream pipeline');
      // Consuming result.text starts the HTTP request and drives the pipeline.
      // Errors (e.g. no model loaded) that bypass onError will surface here.
      Promise.resolve(result.text).then(
        () => console.log('[streamWithCallbacks] result.text resolved'),
        (err: unknown) => {
          console.error('[streamWithCallbacks] result.text rejected:', err);
          // If onError already fired (settled), ignore — the real error was already sent.
          if (settled) return;
          const error = err instanceof Error ? err : new Error(String(err));
          callbacks.onError?.(error);
          settle();
        },
      );
    } catch (err) {
      console.error('[streamWithCallbacks] streamText threw synchronously:', err);
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError?.(error);
      settle();
    }
  });
}

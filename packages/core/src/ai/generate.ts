import {
  generateText,
  streamText,
  Output,
  type LanguageModel,
  type GenerateTextResult,
  type StreamTextResult,
  type ToolSet,
} from 'ai';

export type GenerateOptions = {
  system?: string;
  maxOutputTokens?: number;
  temperature?: number;
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

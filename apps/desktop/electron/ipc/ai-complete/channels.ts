export const AI_COMPLETE = 'ai:complete';
export const AI_COMPLETE_ABORT = 'ai:complete:abort';

export interface AiCompleteRequest {
  text: string;
  caretOffset: number;
  listName: string;
}

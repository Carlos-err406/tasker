type TrySuccess<T> = [null, T];
type TryError = { message: string; stack?: string };
type TryFailure = [TryError, null];
export type TryResult<T> = TrySuccess<T> | TryFailure;

function normalizeError(error: unknown): TryError {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { message: String(error) };
}

export default function $try<T>(fn: () => T): TryResult<T> {
  try {
    const result = fn();
    return [null, result];
  } catch (error) {
    return [normalizeError(error), null];
  }
}

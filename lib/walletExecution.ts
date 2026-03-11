function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function isRetryableWakeError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();

  // Never retry user-meaningful failures.
  const nonRetryablePatterns = [
    'not_granted',
    'permission',
    'rejected',
    'denied',
    'insufficient',
    'assert',
    'execution failed',
    'invalid',
  ];

  if (nonRetryablePatterns.some((pattern) => message.includes(pattern))) {
    return false;
  }

  // Retry only on likely wallet wake-up / popup bootstrap failures.
  const retryablePatterns = [
    'no response',
    'did not respond',
    'wallet not ready',
    'initializing',
    'popup',
  ];

  return retryablePatterns.some((pattern) => message.includes(pattern));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeWithRetry<T>(
  execute: () => Promise<T>,
  options?: {
    retryDelayMs?: number;
    onRetry?: () => void;
  }
): Promise<T> {
  try {
    return await execute();
  } catch (error) {
    if (!isRetryableWakeError(error)) {
      throw error;
    }

    options?.onRetry?.();
    await sleep(options?.retryDelayMs ?? 1000);

    return execute();
  }
}

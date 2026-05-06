// Sui transaction execution wrapper
// Simpler than Aleo — Sui txs are deterministic, minimal retry needed

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
    const message = error instanceof Error ? error.message.toLowerCase() : '';

    // Don't retry user rejections or validation errors
    const nonRetryable = [
      'rejected',
      'denied',
      'cancelled',
      'insufficient',
      'user rejected',
    ];
    if (nonRetryable.some(p => message.includes(p))) {
      throw error;
    }

    // Retry once for transient wallet errors
    options?.onRetry?.();
    await new Promise(r => setTimeout(r, options?.retryDelayMs ?? 1000));
    return execute();
  }
}

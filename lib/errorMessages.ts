// Translates raw Sui/wallet transaction errors into copy a trader can act on.
// The raw message is preserved alongside the friendly title for debugging.

export interface FriendlyError {
  title: string;
  detail: string;
}

export function humanizeTxError(err: unknown): FriendlyError {
  const raw = err instanceof Error ? err.message : String(err ?? 'Transaction failed');
  const lower = raw.toLowerCase();

  if (lower.includes('rejected from user') || lower.includes('user reject') || lower.includes('rejected by user')) {
    return { title: 'You cancelled the transaction in your wallet.', detail: raw };
  }
  if (lower.includes('gasbalancetoolow') || lower.includes('insufficientgas') || lower.includes('unable to pay') || lower.includes('no valid gas')) {
    return { title: 'Not enough SUI for gas — grab free SUI from faucet.sui.io and retry.', detail: raw };
  }
  if (lower.includes('insufficientcoinbalance')) {
    return { title: 'Not enough DUSDC for this trade. Lower the amount or top up.', detail: raw };
  }
  if (lower.includes('moveabort')) {
    return { title: 'The contract rejected this trade — the round may have just closed or moved. Refresh and try again.', detail: raw };
  }
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('timeout')) {
    return { title: 'Network hiccup — your funds are untouched. Try again.', detail: raw };
  }
  return { title: 'Transaction failed — your funds are untouched.', detail: raw };
}

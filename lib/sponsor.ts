// Onara gas-station client (github.com/unconfirmedlabs/onara).
// Sponsors the one-time PredictManager creation so account setup is gas-free.
// Degrades gracefully: if NEXT_PUBLIC_ONARA_URL is unset or the server is
// down, callers fall back to user-paid transactions.

const ONARA_URL = (process.env.NEXT_PUBLIC_ONARA_URL ?? '').replace(/\/$/, '');

export interface SponsorStatus {
  network: string;
  chainId: string;
  address: string;
  balances?: { active: string; pending: string };
}

export async function getSponsorStatus(): Promise<SponsorStatus | null> {
  if (!ONARA_URL) return null;
  try {
    const r = await fetch(`${ONARA_URL}/status`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = (await r.json()) as SponsorStatus;
    return j?.address ? j : null;
  } catch {
    return null;
  }
}

export interface SponsorResult {
  digest: string;
}

/**
 * Submit a user-signed transaction (gas owner = sponsor) for co-signing +
 * execution. On success Onara returns the raw Sui gRPC execution result:
 * `{ $kind: 'Transaction' | 'FailedTransaction', Transaction?: { digest, … } }`
 * — we normalize that to a digest and surface on-chain failures as errors.
 */
export async function submitSponsored(args: {
  sender: string;
  txBytes: string;
  txSignature: string;
}): Promise<SponsorResult> {
  // waitForExecution=false: the worker returns as soon as the tx executes
  // (digest in hand) instead of also waiting for indexing — which can exceed
  // the worker's clock and surface as a 504 even though the tx landed.
  // Callers confirm with client.waitForTransaction themselves.
  const r = await fetch(`${ONARA_URL}/sponsor?waitForExecution=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const json = (await r.json().catch(() => ({}))) as {
    $kind?: string;
    Transaction?: { digest?: string };
    FailedTransaction?: { digest?: string; effects?: { status?: { error?: unknown } } };
    digest?: string;
    status?: string;
    error?: string;
  };
  if (!r.ok) {
    // "unconfirmed" still carries a digest — the tx was submitted; recover it
    // rather than erroring (a retry here could double-execute).
    if (json.digest) return { digest: json.digest };
    throw new Error(`Sponsor declined: ${(json.error ?? JSON.stringify(json)).slice(0, 300)}`);
  }
  if (json.FailedTransaction) {
    const err = json.FailedTransaction.effects?.status?.error;
    throw new Error(
      typeof err === 'string' ? err : `Transaction failed on-chain${err ? ': ' + JSON.stringify(err).slice(0, 200) : ''}`,
    );
  }
  const digest = json.Transaction?.digest ?? json.digest;
  if (!digest) {
    throw new Error(`Sponsor response had no digest: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { digest };
}

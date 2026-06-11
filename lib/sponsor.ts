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
  digest?: string;
  [key: string]: unknown;
}

/** Submit a user-signed transaction (gas owner = sponsor) for co-signing + execution. */
export async function submitSponsored(args: {
  sender: string;
  txBytes: string;
  txSignature: string;
}): Promise<SponsorResult> {
  const r = await fetch(`${ONARA_URL}/sponsor?waitForExecution=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    throw new Error(`Sponsor declined: ${(await r.text()).slice(0, 300)}`);
  }
  return (await r.json()) as SponsorResult;
}

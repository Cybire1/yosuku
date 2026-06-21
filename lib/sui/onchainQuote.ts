// Client-safe wrapper around the exact on-chain quote. The actual devInspect runs
// in the /api/yosuku/quote server route (Node), which keeps the @yosuku/deepbook-predict SDK
// — and Node's Buffer — out of the browser bundle.
import { QuoteSchema, parseOne } from './schemas';

export interface OnChainQuote {
  mintCost: number; // DUSDC to open `quantity` now
  redeemPayout: number; // DUSDC to close `quantity` now
}

export async function fetchOnChainQuote(a: {
  oracleId: string;
  expiry: number | string | bigint;
  strike: number | string | bigint;
  isUp: boolean;
  quantity: number | bigint;
}): Promise<OnChainQuote> {
  const params = new URLSearchParams({
    oracle: a.oracleId,
    expiry: String(a.expiry),
    strike: String(a.strike),
    isUp: String(a.isUp),
    quantity: String(a.quantity),
  });
  const res = await fetch(`/api/yosuku/quote?${params.toString()}`);
  if (!res.ok) throw new Error(`on-chain quote ${res.status}`);
  const q = parseOne(QuoteSchema, await res.json(), 'quote');
  if (!q) throw new Error('on-chain quote returned malformed data');
  return q as OnChainQuote;
}

/** Exact on-chain quote for a RANGE position (settles inside (lower, higher]). */
export async function fetchOnChainRangeQuote(a: {
  oracleId: string;
  expiry: number | string | bigint;
  lower: number | string | bigint;
  higher: number | string | bigint;
  quantity: number | bigint;
}): Promise<OnChainQuote> {
  const params = new URLSearchParams({
    kind: 'range',
    oracle: a.oracleId,
    expiry: String(a.expiry),
    lower: String(a.lower),
    higher: String(a.higher),
    quantity: String(a.quantity),
  });
  const res = await fetch(`/api/yosuku/quote?${params.toString()}`);
  if (!res.ok) throw new Error(`on-chain range quote ${res.status}`);
  const q = parseOne(QuoteSchema, await res.json(), 'range quote');
  if (!q) throw new Error('on-chain range quote returned malformed data');
  return q as OnChainQuote;
}

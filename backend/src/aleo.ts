import { config } from './config.js';

const { aleoEndpoint, aleoNetwork, program, tokenProgram, programAddress } = config;

let cachedBlockHeight = 0;
let lastHeightFetch = 0;

/** Fetch latest block height (cached for 5s to avoid hammering) */
export async function getBlockHeight(): Promise<number> {
  const now = Date.now();
  if (cachedBlockHeight > 0 && now - lastHeightFetch < 5000) {
    return cachedBlockHeight;
  }
  const res = await fetch(`${aleoEndpoint}/${aleoNetwork}/latest/height`);
  if (!res.ok) throw new Error(`Block height fetch failed: ${res.status}`);
  cachedBlockHeight = parseInt(await res.text(), 10);
  lastHeightFetch = now;
  return cachedBlockHeight;
}

/** Read a public mapping value. Returns null if key doesn't exist. */
export async function getMapping(mapping: string, key: string): Promise<string | null> {
  const url = `${aleoEndpoint}/${aleoNetwork}/program/${program}/mapping/${mapping}/${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const text = await res.text();
  const cleaned = text.replace(/"/g, '').trim();
  // Aleo API returns "null" (string) for non-existent keys with HTTP 200
  if (cleaned === 'null' || cleaned === '') return null;
  return cleaned;
}

/** Parse a u64 mapping value to number */
export function parseU64(val: string | null): number {
  if (!val) return 0;
  return parseInt(val.replace('u64', '').trim(), 10) || 0;
}

/** Parse a u128 mapping value to number (USDCx amounts) */
export function parseU128(val: string | null): number {
  if (!val) return 0;
  return parseInt(val.replace('u128', '').trim(), 10) || 0;
}

/** Parse a u32 mapping value to number */
export function parseU32(val: string | null): number {
  if (!val) return 0;
  return parseInt(val.replace('u32', '').trim(), 10) || 0;
}

/** Get the program's USDCx balance (how much the contract can pay out) */
export async function getProgramUsdcxBalance(): Promise<number> {
  const url = `${aleoEndpoint}/${aleoNetwork}/program/${tokenProgram}/mapping/balances/${programAddress}`;
  const res = await fetch(url);
  if (!res.ok) return 0;
  const text = await res.text();
  const cleaned = text.replace(/"/g, '').trim();
  if (cleaned === 'null' || cleaned === '') return 0;
  return parseU128(cleaned);
}

/** Check if a round exists (has a target price set) */
export async function roundExists(roundId: number): Promise<boolean> {
  const target = await getMapping('rt', `${roundId}u64`);
  return target !== null;
}

/** Check if a round is resolved (v7: check ro mapping for outcome 1=YES or 2=NO) */
export async function isRoundResolved(roundId: number): Promise<boolean> {
  const raw = await getMapping('ro', `${roundId}u64`);
  if (!raw) return false;
  const outcome = parseInt(raw.replace('u8', '').trim(), 10);
  return outcome === 1 || outcome === 2;
}

/** Check if a round deadline has passed (for resolver to know when to resolve) */
export async function isRoundExpired(roundId: number): Promise<boolean> {
  const deadline = await getRoundDeadline(roundId);
  if (deadline === 0) return false;
  const height = await getBlockHeight();
  return height >= deadline;
}

/** Get round outcome: 0=pending, 1=YES, 2=NO */
export async function getRoundOutcome(roundId: number): Promise<number> {
  const raw = await getMapping('ro', `${roundId}u64`);
  if (!raw) return 0;
  return parseInt(raw.replace('u8', '').trim(), 10) || 0;
}

/** Get dark pool combined total (visible during betting) */
export async function getDarkPool(roundId: number): Promise<number> {
  const raw = await getMapping('rp', `${roundId}u64`);
  return parseU128(raw);
}

/** Get YES pool (only populated after resolution) */
export async function getYesPool(roundId: number): Promise<number> {
  const raw = await getMapping('ry', `${roundId}u64`);
  return parseU128(raw);
}

/** Get NO pool (only populated after resolution) */
export async function getNoPool(roundId: number): Promise<number> {
  const raw = await getMapping('rn', `${roundId}u64`);
  return parseU128(raw);
}

/** Get round deadline (block height) */
export async function getRoundDeadline(roundId: number): Promise<number> {
  const raw = await getMapping('rd', `${roundId}u64`);
  return parseU32(raw);
}

/**
 * Binary search for the highest existing round ID.
 * Much faster than linear scan when there are hundreds of rounds.
 */
export async function findHighestRound(): Promise<number> {
  // Exponential probe to find upper bound
  let lo = 0;
  let hi = 1;
  while (await roundExists(hi)) {
    lo = hi;
    hi *= 2;
    if (hi > 100000) break; // safety cap
  }

  // Binary search between lo and hi
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (await roundExists(mid)) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  // Handle gaps: check a few IDs beyond the found highest in parallel
  const base = lo;
  const gapChecks = await Promise.all(
    [1, 2, 3, 4, 5].map(offset =>
      roundExists(base + offset).then(exists => ({ id: base + offset, exists }))
    )
  );
  for (const { id, exists } of gapChecks) {
    if (exists && id > lo) lo = id;
  }

  return (await roundExists(lo)) ? lo : -1;
}

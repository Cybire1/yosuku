import {
  BTC_PREDICTION_PROGRAM,
  BACKEND_URL,
  ROUND_DURATION_SECONDS,
  fetchMapping,
  parseU64,
  parseU128,
  type RoundState,
  type UserPosition,
} from '@/lib/predictionContract';

// Avg block time on Aleo testnet (~3.5s)
const AVG_BLOCK_TIME_MS = 3500;

// Cache for round metadata from backend
const metaCache = new Map<number, { durationSecs: number; startBlock: number }>();
let backendReachable = true;
let backendCheckTime = 0;

async function fetchRoundMeta(roundId: number): Promise<{ durationSecs: number; startBlock: number } | null> {
  const cached = metaCache.get(roundId);
  if (cached) return cached;
  // Skip if backend is localhost (env not configured)
  if (BACKEND_URL.includes('localhost')) return null;
  // Skip if backend was unreachable or returned errors recently (retry every 60s)
  if (!backendReachable && Date.now() - backendCheckTime < 60_000) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/round-meta/${roundId}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      backendReachable = false;
      backendCheckTime = Date.now();
      return null;
    }
    backendReachable = true;
    const data = await res.json();
    const meta = { durationSecs: data.durationSecs, startBlock: data.startBlock };
    metaCache.set(roundId, meta);
    return meta;
  } catch {
    backendReachable = false;
    backendCheckTime = Date.now();
    return null;
  }
}

// Cached block height
let cachedHeight = 0;
let heightFetchedAt = 0;

export async function getBlockHeight(): Promise<number> {
  if (cachedHeight > 0 && Date.now() - heightFetchedAt < 10_000) return cachedHeight;
  try {
    const res = await fetch('https://api.explorer.provable.com/v1/testnet/latest/height');
    if (!res.ok) return cachedHeight;
    cachedHeight = parseInt(await res.text(), 10);
    heightFetchedAt = Date.now();
    return cachedHeight;
  } catch {
    return cachedHeight;
  }
}

export async function fetchRound(roundId: number): Promise<RoundState | null> {
  try {
    // v7 mapping names: rt=target, rd=deadline, ro=outcome(u8), rp=dark_pool, ry=yes_pool, rn=no_pool
    // ry/rn are only set at resolution (dark pool mechanic)
    const [targetRaw, deadlineRaw, outcomeRaw, darkPoolRaw, yesRaw, noRaw, currentHeight] = await Promise.all([
      fetchMapping(BTC_PREDICTION_PROGRAM, 'rt', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'rd', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'ro', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'rp', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'ry', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'rn', `${roundId}u64`),
      getBlockHeight(),
    ]);

    if (!targetRaw || targetRaw === 'null') return null;

    const targetPrice = parseU64(targetRaw);
    const deadline = parseInt(deadlineRaw?.replace('u32', '').trim() || '0', 10);

    // Fetch round metadata from backend for accurate duration
    const meta = await fetchRoundMeta(roundId);
    const durationSecs = meta?.durationSecs ?? ROUND_DURATION_SECONDS;
    const durationMs = durationSecs * 1000;

    // v7: outcome is u8 (0=pending, 1=YES, 2=NO)
    const outcomeVal = outcomeRaw ? parseInt(outcomeRaw.replace('u8', '').trim(), 10) : 0;
    const resolved = outcomeVal === 1 || outcomeVal === 2;
    const outcome = resolved ? (outcomeVal === 1 ? true : false) : null;

    const blocksLeft = Math.max(0, deadline - currentHeight);
    const msLeft = blocksLeft * AVG_BLOCK_TIME_MS;
    const endTime = Date.now() + msLeft;

    // Dark pool: during betting, only totalPool (rp) is visible
    // After resolution, ry/rn are revealed
    const totalPool = parseU128(darkPoolRaw);
    const yesPool = resolved ? parseU128(yesRaw) : 0;
    const noPool = resolved ? parseU128(noRaw) : 0;

    return {
      id: roundId,
      targetPrice,
      deadline,
      durationMs,
      endTime,
      yesPool,
      noPool,
      totalPool,
      resolved,
      outcome,
    };
  } catch {
    return null;
  }
}

export function loadPositions(): UserPosition[] {
  try {
    const saved: { roundId: number; side: string; amount: number }[] =
      JSON.parse(localStorage.getItem('v8_positions') || '[]');

    const map = new Map<number, UserPosition>();
    for (const p of saved) {
      const existing = map.get(p.roundId);
      if (existing) {
        if (p.side === 'YES') existing.yesDeposit += p.amount;
        else existing.noDeposit += p.amount;
      } else {
        map.set(p.roundId, {
          roundId: p.roundId,
          yesDeposit: p.side === 'YES' ? p.amount : 0,
          noDeposit: p.side === 'NO' ? p.amount : 0,
          claimed: false,
        });
      }
    }

    const claimed: number[] = JSON.parse(localStorage.getItem('v8_claimed') || '[]');
    for (const id of claimed) {
      const pos = map.get(id);
      if (pos) pos.claimed = true;
    }

    return Array.from(map.values());
  } catch {
    return [];
  }
}

export function savePosition(roundId: number, side: 'YES' | 'NO', amount: number) {
  const positions = JSON.parse(localStorage.getItem('v8_positions') || '[]');
  positions.push({ roundId, side, amount, timestamp: Date.now() });
  localStorage.setItem('v8_positions', JSON.stringify(positions));
}

export function markClaimed(roundId: number) {
  const claimed: number[] = JSON.parse(localStorage.getItem('v8_claimed') || '[]');
  if (!claimed.includes(roundId)) {
    claimed.push(roundId);
    localStorage.setItem('v8_claimed', JSON.stringify(claimed));
  }
}

// ── v8 Commitment Storage ──────────────────────────────
// Stores the bet preimage (side, amount, salt) needed to claim/forfeit later.
// Keyed by address_roundId for lookup.

export interface BetCommitmentData {
  side: 'YES' | 'NO';
  amount: number;
  salt: string;
  timestamp: number;
}

export function saveBetCommitment(
  address: string,
  roundId: number,
  side: 'YES' | 'NO',
  amount: number,
  salt: string,
) {
  const commitments = JSON.parse(localStorage.getItem('v8_commitments') || '{}');
  const key = `${address}_${roundId}`;
  commitments[key] = { side, amount, salt, timestamp: Date.now() } as BetCommitmentData;
  localStorage.setItem('v8_commitments', JSON.stringify(commitments));
}

export function getBetCommitment(
  address: string,
  roundId: number,
): BetCommitmentData | null {
  const commitments = JSON.parse(localStorage.getItem('v8_commitments') || '{}');
  return commitments[`${address}_${roundId}`] ?? null;
}

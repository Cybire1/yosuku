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
    // v10 mappings: rt=target, rd=deadline, ro=outcome, ym/nm=multipliers, rb=bankroll, yl/nl=locked payouts, tp=premiums
    const [targetRaw, deadlineRaw, outcomeRaw, ymRaw, nmRaw, bankrollRaw, ylRaw, nlRaw, tpRaw, currentHeight] = await Promise.all([
      fetchMapping(BTC_PREDICTION_PROGRAM, 'rt', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'rd', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'ro', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'ym', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'nm', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'rb', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'yl', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'nl', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'tp', `${roundId}u64`),
      getBlockHeight(),
    ]);

    if (!targetRaw || targetRaw === 'null') return null;

    const targetPrice = parseU64(targetRaw);
    const deadline = parseInt(deadlineRaw?.replace('u32', '').trim() || '0', 10);

    // Fetch round metadata from backend for accurate duration
    const meta = await fetchRoundMeta(roundId);
    const durationSecs = meta?.durationSecs ?? ROUND_DURATION_SECONDS;
    const durationMs = durationSecs * 1000;

    // outcome is u8 (0=pending, 1=YES, 2=NO)
    const outcomeVal = outcomeRaw ? parseInt(outcomeRaw.replace('u8', '').trim(), 10) : 0;
    const resolved = outcomeVal === 1 || outcomeVal === 2;
    const outcome = resolved ? (outcomeVal === 1 ? true : false) : null;

    const blocksLeft = Math.max(0, deadline - currentHeight);
    const msLeft = blocksLeft * AVG_BLOCK_TIME_MS;
    const endTime = Date.now() + msLeft;

    const yesMult = parseU64(ymRaw);
    const noMult = parseU64(nmRaw);
    const bankroll = parseU128(bankrollRaw);
    const totalPool = parseU128(tpRaw);
    const yesLocked = parseU128(ylRaw);
    const noLocked = parseU128(nlRaw);

    return {
      id: roundId,
      targetPrice,
      deadline,
      durationMs,
      endTime,
      yesMult,
      noMult,
      bankroll,
      totalPool,
      yesLocked,
      noLocked,
      // Legacy aliases used by older chart/stat components that still expect
      // v8 pool names. In v10 these represent locked side exposure.
      yesPool: yesLocked,
      noPool: noLocked,
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
      JSON.parse(localStorage.getItem('v10_positions') || '[]');

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

    const claimed: number[] = JSON.parse(localStorage.getItem('v10_claimed') || '[]');
    for (const id of claimed) {
      const pos = map.get(id);
      if (pos) pos.claimed = true;
    }

    return Array.from(map.values());
  } catch {
    return [];
  }
}

export function savePosition(roundId: number, side: 'YES' | 'NO', amount: number, payout?: number) {
  const positions = JSON.parse(localStorage.getItem('v10_positions') || '[]');
  positions.push({ roundId, side, amount, payout: payout ?? 0, timestamp: Date.now() });
  localStorage.setItem('v10_positions', JSON.stringify(positions));
}

export function markClaimed(roundId: number) {
  const claimed: number[] = JSON.parse(localStorage.getItem('v10_claimed') || '[]');
  if (!claimed.includes(roundId)) {
    claimed.push(roundId);
    localStorage.setItem('v10_claimed', JSON.stringify(claimed));
  }
}

// ── v10 Commitment Storage ──────────────────────────────
// Stores bet info (side, amount, payout, salt) for recovery.
// Keyed by address_roundId for lookup.

export interface BetCommitmentData {
  side: 'YES' | 'NO';
  amount: number;
  payout: number;
  salt: string;
  timestamp: number;
  txId?: string;
}

export function saveBetCommitment(
  address: string,
  roundId: number,
  side: 'YES' | 'NO',
  amount: number,
  payout: number,
  salt: string,
  txId?: string,
) {
  const commitments = JSON.parse(localStorage.getItem('v10_commitments') || '{}');
  const key = `${address}_${roundId}`;
  commitments[key] = { side, amount, payout, salt, timestamp: Date.now(), txId } as BetCommitmentData;
  localStorage.setItem('v10_commitments', JSON.stringify(commitments));

  // Also store tx ID in the shared bet_txids map used by recordResolver
  if (txId) {
    const betTxs = JSON.parse(localStorage.getItem('pred_bet_txids') || '{}');
    betTxs[roundId] = txId;
    localStorage.setItem('pred_bet_txids', JSON.stringify(betTxs));
  }
}

export function getBetCommitment(
  address: string,
  roundId: number,
): BetCommitmentData | null {
  const commitments = JSON.parse(localStorage.getItem('v10_commitments') || '{}');
  return commitments[`${address}_${roundId}`] ?? null;
}

// Get saved payout for a position (stored at bet time from on-chain multiplier)
export function getSavedPayout(address: string, roundId: number): number {
  const commitment = getBetCommitment(address, roundId);
  if (commitment?.payout) return commitment.payout;
  // Fallback: check positions array
  const positions: { roundId: number; payout?: number }[] =
    JSON.parse(localStorage.getItem('v10_positions') || '[]');
  const match = positions.find(p => p.roundId === roundId);
  return match?.payout ?? 0;
}

/**
 * Recover a single bet commitment from the chain for a specific round.
 * Falls back to recordResolver's tx-based decrypt path if requestRecords fails.
 * On success, caches back to localStorage.
 */
export async function recoverBetFromChain(
  wallet: {
    requestRecords?: (program: string, includePlaintext?: boolean) => Promise<any[]>;
    decrypt?: (cipherText: string, tpk?: string, programId?: string, functionName?: string, index?: number) => Promise<string>;
  },
  address: string,
  roundId: number,
): Promise<BetCommitmentData | null> {
  // Strategy 1: bulk fetch — requestRecords with plaintext, find the matching round
  if (wallet.requestRecords) {
    try {
      const all = await recoverAllFromChain(wallet, address);
      const match = all.find(r => r.rid === roundId);
      if (match) return getBetCommitment(address, roundId);
    } catch {
      // Fall through to strategy 2
    }
  }

  // Strategy 2: tx-based decrypt via recordResolver (needs stored tx ID)
  try {
    const { resolveSlotRecord } = await import('@/lib/recordResolver');
    const plaintext = await resolveSlotRecord(wallet, roundId);
    if (!plaintext) return null;

    const parsed = parseReceiptPlaintext(plaintext);
    if (!parsed || parsed.rid !== roundId) return null;

    const commitment: BetCommitmentData = {
      side: parsed.side ? 'YES' : 'NO',
      amount: parsed.amt,
      payout: parsed.payout,
      salt: parsed.salt,
      timestamp: Date.now(),
    };

    saveBetCommitment(address, roundId, commitment.side, commitment.amount, commitment.payout, commitment.salt);
    console.log('[Recovery] Recovered round', roundId, 'via tx decrypt');
    return commitment;
  } catch (e) {
    console.warn('[Recovery] Chain recovery failed:', e);
    return null;
  }
}

/**
 * Bulk recovery: fetch ALL BetReceipt records from chain via requestRecords.
 * Rebuilds v10_commitments and v10_positions in localStorage from on-chain data.
 */
export async function recoverAllFromChain(
  wallet: {
    requestRecords?: (program: string, includePlaintext?: boolean) => Promise<any[]>;
  },
  address: string,
): Promise<{ rid: number; side: boolean; amt: number; payout: number; salt: string }[]> {
  if (!wallet.requestRecords) {
    console.warn('[Recovery] requestRecords not available');
    return [];
  }

  const { BTC_PREDICTION_PROGRAM } = await import('@/lib/predictionContract');
  const records = await wallet.requestRecords(BTC_PREDICTION_PROGRAM, true);
  console.log('[Recovery] requestRecords returned', records?.length ?? 0, 'records');

  if (!records?.length) return [];

  const recovered: { rid: number; side: boolean; amt: number; payout: number; salt: string }[] = [];

  for (const r of records) {
    const pt = extractPlaintextFromRecord(r);
    if (!pt) continue;

    const parsed = parseReceiptPlaintext(pt);
    if (!parsed) continue;

    recovered.push(parsed);

    // Cache to localStorage — commitment + position
    const side: 'YES' | 'NO' = parsed.side ? 'YES' : 'NO';
    const existing = getBetCommitment(address, parsed.rid);
    if (!existing) {
      saveBetCommitment(address, parsed.rid, side, parsed.amt, parsed.payout, parsed.salt);
      savePosition(parsed.rid, side, parsed.amt, parsed.payout);
      console.log('[Recovery] Recovered round', parsed.rid, side, parsed.amt, 'payout:', parsed.payout);
    }
  }

  console.log('[Recovery] Total recovered:', recovered.length, 'bets');
  return recovered;
}

/** Extract plaintext string from various record formats returned by requestRecords */
function extractPlaintextFromRecord(record: unknown): string | null {
  if (typeof record === 'string') return record;
  if (record && typeof record === 'object') {
    const r = record as Record<string, unknown>;
    if (typeof r.plaintext === 'string') return r.plaintext;
    if (typeof r.data === 'string') return r.data;
    if (r.data && typeof r.data === 'object') return JSON.stringify(r.data);
    try { return JSON.stringify(record); } catch { return null; }
  }
  return null;
}

/** Parse decrypted BetReceipt plaintext into structured data.
 *  v10 BetReceipt: { owner, rid, side, amt, payout, salt } */
function parseReceiptPlaintext(pt: string): { rid: number; side: boolean; amt: number; payout: number; salt: string } | null {
  try {
    const ridMatch = pt.match(/rid:\s*(\d+)u64/);
    const sideMatch = pt.match(/side:\s*(true|false)/);
    const amtMatch = pt.match(/amt:\s*(\d+)u128/);
    const payoutMatch = pt.match(/payout:\s*(\d+)u128/);
    const saltMatch = pt.match(/salt:\s*(\d+field)/);

    if (!ridMatch || !sideMatch || !amtMatch || !payoutMatch || !saltMatch) return null;

    return {
      rid: parseInt(ridMatch[1], 10),
      side: sideMatch[1] === 'true',
      amt: parseInt(amtMatch[1], 10),
      payout: parseInt(payoutMatch[1], 10),
      salt: saltMatch[1],
    };
  } catch {
    return null;
  }
}

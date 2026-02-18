import {
  BTC_PREDICTION_PROGRAM,
  fetchMapping,
  parseU64,
  type RoundState,
  type UserPosition,
} from '@/lib/predictionContract';

// Avg block time on Aleo testnet (~3.5s)
const AVG_BLOCK_TIME_MS = 3500;

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
    const [targetRaw, deadlineRaw, durationRaw, resolvedRaw, outcomeRaw, yesRaw, noRaw, currentHeight] = await Promise.all([
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_target_price', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_deadline', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_duration', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_resolved', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_outcome', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_yes_pool', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_no_pool', `${roundId}u64`),
      getBlockHeight(),
    ]);

    if (!targetRaw || targetRaw === 'null') return null;

    const targetPrice = parseU64(targetRaw);
    const deadline = parseInt(deadlineRaw?.replace('u32', '').trim() || '0', 10);
    const durationSecs = parseInt(durationRaw?.replace('u32', '').trim() || '300', 10);
    const durationMs = durationSecs * 1000;
    const resolved = resolvedRaw?.trim() === 'true';
    const outcome = resolved ? outcomeRaw?.trim() === 'true' : null;

    const blocksLeft = Math.max(0, deadline - currentHeight);
    const msLeft = blocksLeft * AVG_BLOCK_TIME_MS;
    const endTime = Date.now() + msLeft;

    return {
      id: roundId,
      targetPrice,
      deadline,
      durationMs,
      endTime,
      yesPool: parseU64(yesRaw),
      noPool: parseU64(noRaw),
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
      JSON.parse(localStorage.getItem('pred_positions') || '[]');

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

    const claimed: number[] = JSON.parse(localStorage.getItem('pred_claimed') || '[]');
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
  const positions = JSON.parse(localStorage.getItem('pred_positions') || '[]');
  positions.push({ roundId, side, amount, timestamp: Date.now() });
  localStorage.setItem('pred_positions', JSON.stringify(positions));
}

export function markClaimed(roundId: number) {
  const claimed: number[] = JSON.parse(localStorage.getItem('pred_claimed') || '[]');
  if (!claimed.includes(roundId)) {
    claimed.push(roundId);
    localStorage.setItem('pred_claimed', JSON.stringify(claimed));
  }
}

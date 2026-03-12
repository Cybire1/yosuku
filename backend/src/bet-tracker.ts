import { Router } from 'express';

// ── In-memory dark pool accumulators ───────────────────
// Tracks per-side bet amounts that the frontend reports.
// The contract's `rp` mapping only stores the combined total (dark pool).
// At resolution, the resolver passes these accumulators to `resolve()`.

interface PoolState {
  yes: number;  // micro-USDCx accumulated on YES
  no: number;   // micro-USDCx accumulated on NO
}

// ── Round metadata (duration, start block) ─────────────
// Stored here because the on-chain contract only stores deadline,
// not start block or duration. Frontend needs this for accurate timers.

interface RoundMeta {
  durationSecs: number;   // round duration in seconds
  startBlock: number;     // block height when round was created
}

const pools = new Map<number, PoolState>();
const roundMeta = new Map<number, RoundMeta>();

export function setRoundMeta(roundId: number, durationSecs: number, startBlock: number): void {
  roundMeta.set(roundId, { durationSecs, startBlock });
}

export function getRoundMeta(roundId: number): RoundMeta | undefined {
  return roundMeta.get(roundId);
}

export function addBet(roundId: number, side: 'YES' | 'NO', amount: number): void {
  let pool = pools.get(roundId);
  if (!pool) {
    pool = { yes: 0, no: 0 };
    pools.set(roundId, pool);
  }
  if (side === 'YES') {
    pool.yes += amount;
  } else {
    pool.no += amount;
  }
  console.log(`[BetTracker] Round #${roundId}: +${amount} on ${side} → YES=${pool.yes} NO=${pool.no}`);
}

export function getPoolTotals(roundId: number): PoolState {
  return pools.get(roundId) || { yes: 0, no: 0 };
}

export function resetPool(roundId: number): void {
  pools.delete(roundId);
}

// ── Express routes ─────────────────────────────────────

export const betTrackerRouter = Router();

// Frontend reports bet amount here after placing on-chain bet
// Side is NOT reported — it is ZK-hidden on-chain and must stay hidden off-chain too.
// The resolver gets per-side totals from on-chain data at resolution time.
betTrackerRouter.post('/api/bet', (req, res) => {
  const { roundId, side, amount } = req.body;

  if (typeof roundId !== 'number' || roundId < 0) {
    return res.status(400).json({ error: 'Invalid roundId' });
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  // Accept side if provided (backward compat) but it's no longer required
  if (side === 'YES' || side === 'NO') {
    addBet(roundId, side, amount);
  } else {
    // No side provided — track as total only (add to YES as accounting placeholder,
    // the resolver will use on-chain data for actual per-side split)
    addBet(roundId, 'YES', amount);
  }
  res.json({ ok: true });
});

// Dark pool endpoint: only exposes combined total (per-side split hidden until resolution)
betTrackerRouter.get('/api/pool/:roundId', (req, res) => {
  const roundId = parseInt(req.params.roundId, 10);
  if (isNaN(roundId)) {
    return res.status(400).json({ error: 'Invalid roundId' });
  }
  const pool = getPoolTotals(roundId);
  res.json({ roundId, total: pool.yes + pool.no });
});

// Round metadata: duration + start block (needed by frontend for accurate timers)
betTrackerRouter.get('/api/round-meta/:roundId', (req, res) => {
  const roundId = parseInt(req.params.roundId, 10);
  if (isNaN(roundId)) {
    return res.status(400).json({ error: 'Invalid roundId' });
  }
  const meta = getRoundMeta(roundId);
  if (!meta) {
    return res.status(404).json({ error: 'Round metadata not found' });
  }
  res.json({ roundId, ...meta });
});

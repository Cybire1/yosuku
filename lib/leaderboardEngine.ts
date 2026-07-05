export type RawAmount = string | number | bigint;

export interface LeaderboardMint {
  event_digest?: string;
  digest?: string;
  event_index?: number;
  checkpoint_timestamp_ms: number;
  manager_id: string;
  trader?: string;
  oracle_id: string;
  expiry?: RawAmount;
  strike: RawAmount;
  is_up: boolean;
  quantity: RawAmount;
  cost: RawAmount;
}

export interface LeaderboardRedeem {
  event_digest?: string;
  digest?: string;
  event_index?: number;
  checkpoint_timestamp_ms: number;
  manager_id: string;
  owner?: string;
  trader?: string;
  oracle_id: string;
  expiry?: RawAmount;
  strike: RawAmount;
  is_up: boolean;
  quantity: RawAmount;
  payout: RawAmount;
  is_settled: boolean;
}

export interface LeaderboardRanking {
  manager_id: string;
  owner: string;
  pnl: number;
  roi: number;
  winRate: number;
  tradeCount: number;
  settledTrades: number;
  bestStreak: number;
  volume: number;
}

interface Lot { quantity: bigint; cost: bigint }
interface RealizedCall {
  owner: string;
  managerId: string;
  timestamp: number;
  settled: boolean;
  cost: bigint;
  payout: bigint;
}
interface CallAccum extends RealizedCall { key: string }

const DUSDC_SCALE = 1_000_000;

function units(value: RawAmount): bigint {
  const normalized = String(value);
  if (!/^-?\d+$/.test(normalized)) throw new Error(`Leaderboard amount is not an integer: ${normalized}`);
  return BigInt(normalized);
}

function eventKey(event: LeaderboardMint | LeaderboardRedeem): string {
  return event.event_digest
    ?? `${event.digest ?? 'unknown'}:${event.event_index ?? 0}:${event.manager_id}:${event.oracle_id}:${event.strike}:${event.is_up}`;
}

function positionKey(event: LeaderboardMint | LeaderboardRedeem): string {
  return [event.manager_id, event.oracle_id, event.expiry ?? '', event.strike, event.is_up].join(':');
}

function callKey(owner: string, event: LeaderboardRedeem): string {
  return [owner, event.oracle_id, event.expiry ?? '', event.strike, event.is_up].join(':');
}

function dedupe<T extends LeaderboardMint | LeaderboardRedeem>(events: T[]): T[] {
  const unique = new Map<string, T>();
  for (const event of events) unique.set(eventKey(event), event);
  return [...unique.values()];
}

function allocate(lot: Lot, requested: bigint): { quantity: bigint; cost: bigint } {
  const quantity = requested < lot.quantity ? requested : lot.quantity;
  const cost = quantity === lot.quantity ? lot.cost : (lot.cost * quantity) / lot.quantity;
  lot.quantity -= quantity;
  lot.cost -= cost;
  return { quantity, cost };
}

function toDusdc(value: bigint): number {
  return Number(value) / DUSDC_SCALE;
}

/** Compute exact realized P&L for complete histories of managers active in the window. */
export function computeLeaderboard(
  mintedInput: LeaderboardMint[],
  redeemedInput: LeaderboardRedeem[],
  windowStartMs: number,
  windowEndMs: number,
): { rankings: LeaderboardRanking[]; unmatchedRedemptions: number; closedCalls: number } {
  const minted = dedupe(mintedInput).sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);
  const redeemed = dedupe(redeemedInput).sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);
  const lots = new Map<string, Lot[]>();

  for (const mint of minted) {
    const key = positionKey(mint);
    const queue = lots.get(key) ?? [];
    queue.push({ quantity: units(mint.quantity), cost: units(mint.cost) });
    lots.set(key, queue);
  }

  const calls = new Map<string, CallAccum>();
  let unmatchedRedemptions = 0;

  for (const redeem of redeemed) {
    const redeemQuantity = units(redeem.quantity);
    if (redeemQuantity <= 0n) continue;
    let remaining = redeemQuantity;
    let matchedQuantity = 0n;
    let matchedCost = 0n;
    const queue = lots.get(positionKey(redeem)) ?? [];

    while (remaining > 0n && queue.length > 0) {
      const lot = queue[0];
      const matched = allocate(lot, remaining);
      remaining -= matched.quantity;
      matchedQuantity += matched.quantity;
      matchedCost += matched.cost;
      if (lot.quantity === 0n) queue.shift();
    }

    if (redeem.checkpoint_timestamp_ms < windowStartMs || redeem.checkpoint_timestamp_ms >= windowEndMs) continue;
    if (matchedQuantity === 0n) {
      unmatchedRedemptions++;
      continue;
    }
    if (remaining > 0n) unmatchedRedemptions++;

    const payout = units(redeem.payout);
    const matchedPayout = matchedQuantity === redeemQuantity ? payout : (payout * matchedQuantity) / redeemQuantity;
    const owner = redeem.owner ?? redeem.trader ?? redeem.manager_id;
    const key = callKey(owner, redeem);
    const previous = calls.get(key);
    if (previous) {
      previous.cost += matchedCost;
      previous.payout += matchedPayout;
      previous.timestamp = Math.max(previous.timestamp, redeem.checkpoint_timestamp_ms);
      previous.settled ||= redeem.is_settled;
    } else {
      calls.set(key, {
        key,
        owner,
        managerId: redeem.manager_id,
        timestamp: redeem.checkpoint_timestamp_ms,
        settled: redeem.is_settled,
        cost: matchedCost,
        payout: matchedPayout,
      });
    }
  }

  const byOwner = new Map<string, RealizedCall[]>();
  for (const call of calls.values()) {
    const ownerCalls = byOwner.get(call.owner) ?? [];
    ownerCalls.push(call);
    byOwner.set(call.owner, ownerCalls);
  }

  const rankings: LeaderboardRanking[] = [];
  for (const [owner, ownerCalls] of byOwner) {
    ownerCalls.sort((a, b) => a.timestamp - b.timestamp);
    let cost = 0n;
    let payout = 0n;
    let wins = 0;
    let settledTrades = 0;
    let currentStreak = 0;
    let bestStreak = 0;
    for (const call of ownerCalls) {
      cost += call.cost;
      payout += call.payout;
      const won = call.payout > call.cost;
      if (won) wins++;
      if (call.settled) {
        settledTrades++;
        currentStreak = won ? currentStreak + 1 : 0;
        bestStreak = Math.max(bestStreak, currentStreak);
      }
    }
    const pnl = payout - cost;
    rankings.push({
      manager_id: ownerCalls[0].managerId,
      owner,
      pnl: toDusdc(pnl),
      roi: cost > 0n ? Number(pnl * 10_000n / cost) / 100 : 0,
      winRate: Math.round((wins / ownerCalls.length) * 100),
      tradeCount: ownerCalls.length,
      settledTrades,
      bestStreak,
      volume: toDusdc(cost),
    });
  }

  rankings.sort((a, b) =>
    (b.pnl - a.pnl) || (b.roi - a.roi) || (b.tradeCount - a.tradeCount) || a.owner.localeCompare(b.owner));
  return { rankings, unmatchedRedemptions, closedCalls: calls.size };
}

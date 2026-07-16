// Leaderboard P&L for the LIVE 6-24 venue (predict-server-beta).
//
// The 4-16 venue exposed a global `/positions/redeemed` feed + manager histories
// (see leaderboardEngine.ts). The 6-24 venue does NOT: it is account-scoped
// (`/accounts/{account_id}/orders`) with no global trade feed, so the route
// enumerates accounts from `account_events::AccountCreated` and pulls each one's
// order feed. This module turns those raw per-account order rows into rankings.
//
// Order feed shape (VERIFIED live 2026-07-15):
//   order_minted            → net_premium (micro DUSDC paid)
//   live_order_redeemed     → redeem_amount (micro DUSDC received on early close)
//   settled_order_redeemed  → payout_amount (micro DUSDC received at settlement; 0 = out-of-money)
//   liquidated_order_redeemed → redeem_amount/payout_amount (received on liquidation)
// All rows carry position_root_id linking a mint to its (possibly partial) closes.

export interface Order624Raw {
  kind: string;
  position_root_id?: string;
  order_id?: string;
  checkpoint_timestamp_ms?: number | string;
  net_premium?: string | number;
  redeem_amount?: string | number;
  payout_amount?: string | number;
}

export interface AccountOrders624 {
  accountId: string;
  owner: string;
  orders: Order624Raw[];
}

// Mirrors leaderboardEngine.LeaderboardRanking so the frontend stays unchanged.
export interface Ranking624 {
  manager_id: string; // repurposed: the 6-24 inner account_id (frontend only reads `owner`)
  owner: string;
  pnl: number;
  roi: number;
  winRate: number;
  tradeCount: number;
  settledTrades: number;
  bestStreak: number;
  volume: number;
}

const DUSDC_SCALE = 1_000_000;
const big = (v: unknown): bigint => {
  const s = String(v ?? '0');
  return /^-?\d+$/.test(s) ? BigInt(s) : 0n;
};
const toDusdc = (v: bigint): number => Number(v) / DUSDC_SCALE;

interface Root {
  premium: bigint;   // net_premium of the originating mint
  payout: bigint;    // Σ redeem/payout across all closes of this position
  hasMint: boolean;  // a matching order_minted was in the fetched window
  redeemed: boolean; // ≥1 close row seen
  settled: boolean;  // reached oracle settlement
  lastRedeemMs: number;
}

/**
 * Realized P&L per account over positions **closed in the window**.
 * A "call" = one position_root that has been redeemed and whose originating mint
 * was in the fetched feed (unmatched redeems are skipped, never assumed cost 0).
 */
export function computeLeaderboard624(
  accounts: AccountOrders624[],
  windowStartMs: number,
  windowEndMs: number,
): { rankings: Ranking624[]; closedCalls: number; rankedTraders: number } {
  const rankings: Ranking624[] = [];
  let closedCalls = 0;

  for (const { accountId, owner, orders } of accounts) {
    const roots = new Map<string, Root>();

    for (const o of orders) {
      const rootId = o.position_root_id || o.order_id;
      if (!rootId) continue;
      let r = roots.get(rootId);
      if (!r) {
        r = { premium: 0n, payout: 0n, hasMint: false, redeemed: false, settled: false, lastRedeemMs: 0 };
        roots.set(rootId, r);
      }
      if (o.kind === 'order_minted') {
        r.premium += big(o.net_premium);
        r.hasMint = true;
      } else if (o.kind.endsWith('_redeemed')) {
        // live closes carry redeem_amount; settled/liquidated carry payout_amount
        r.payout += big(o.redeem_amount ?? o.payout_amount);
        r.redeemed = true;
        if (o.kind === 'settled_order_redeemed') r.settled = true;
        r.lastRedeemMs = Math.max(r.lastRedeemMs, Number(o.checkpoint_timestamp_ms ?? 0));
      }
    }

    const closed = [...roots.values()]
      .filter((r) => r.redeemed && r.hasMint && r.lastRedeemMs >= windowStartMs && r.lastRedeemMs < windowEndMs)
      .sort((a, b) => a.lastRedeemMs - b.lastRedeemMs);
    if (closed.length === 0) continue;

    let cost = 0n;
    let payout = 0n;
    let wins = 0;
    let settledTrades = 0;
    let streak = 0;
    let bestStreak = 0;
    for (const r of closed) {
      cost += r.premium;
      payout += r.payout;
      const won = r.payout > r.premium;
      if (won) wins++;
      if (r.settled) {
        settledTrades++;
        streak = won ? streak + 1 : 0;
        bestStreak = Math.max(bestStreak, streak);
      }
    }
    closedCalls += closed.length;
    const pnl = payout - cost;
    rankings.push({
      manager_id: accountId,
      owner,
      pnl: toDusdc(pnl),
      roi: cost > 0n ? Number((pnl * 10_000n) / cost) / 100 : 0,
      winRate: Math.round((wins / closed.length) * 100),
      tradeCount: closed.length,
      settledTrades,
      bestStreak,
      volume: toDusdc(cost),
    });
  }

  rankings.sort(
    (a, b) => b.pnl - a.pnl || b.roi - a.roi || b.tradeCount - a.tradeCount || a.owner.localeCompare(b.owner),
  );
  return { rankings, closedCalls, rankedTraders: rankings.length };
}

// One settled (or cashed-out / liquidated) trade, joined from the predict624 indexer's
// order feed: an `order_minted` row + its `*_redeemed` row matched on orderId. This is
// the single input shape for the Trade Receipt (in-app card) and the share-card export —
// every field is REAL on-chain data; nothing here is ever estimated or fabricated.
import type { OrderRow624 } from './predict624Client';

export interface SettledTrade {
  orderId: string;
  marketId: string;
  /** 'up' = finite lower / +inf higher · 'down' = −inf lower / finite higher · 'range' = both finite. */
  dir: 'up' | 'down' | 'range';
  /** Finite band bounds in USD; null = infinite on that side. */
  lowerUsd: number | null;
  higherUsd: number | null;
  /** What the user put in (net premium), micro DUSDC. */
  stakeMicro: bigint;
  /** Max payout (position quantity), micro DUSDC. */
  qtyMicro: bigint;
  /** Human leverage (1e9-descaled), e.g. 2.4. */
  leverageX: number;
  /** Actual payout received, micro DUSDC (0 on a loss). */
  payoutMicro: bigint;
  /** payout − stake, micro DUSDC (negative on a loss). */
  pnlMicro: bigint;
  /** The oracle/redemption print in USD, null if the row didn't carry one. */
  settlementUsd: number | null;
  /** When the redeem/claim tx landed (checkpoint ts). NOT the oracle print time —
   *  claims can land any time after the bell. */
  settledAtMs: number;
  /** Market expiry = the second the oracle actually printed (6-24 settles on the
   *  exact-stamp price AT expiry). Null until resolved (needs a market-state fetch);
   *  renderers must fall back to "claimed at" language, never stamp settledAtMs as
   *  the oracle second. */
  expiryMs: number | null;
  openedAtMs: number;
  /** Tx digests for the on-chain proof links. */
  mintDigest: string;
  redeemDigest: string;
  /** settled_order_redeemed = oracle-settled at expiry · live_order_redeemed = cashed out
   *  early at the live price · liquidated_order_redeemed = knocked out. The receipt must
   *  label these honestly (SETTLED stamp vs CASHED OUT vs LIQUIDATED). */
  kind: 'settled_order_redeemed' | 'live_order_redeemed' | 'liquidated_order_redeemed' | string;
}

const POS_INF_TICK = 2 ** 30 - 1;
const tickUsd = (t: number): number => t / 100;

/** Join minted + redeemed order rows (newest-first feed) into SettledTrade[]. */
export function joinSettledTrades(rows: OrderRow624[]): SettledTrade[] {
  const minted = new Map<string, OrderRow624>();
  for (const r of rows) if (r.kind === 'order_minted' && r.orderId) minted.set(r.orderId, r);
  const out: SettledTrade[] = [];
  for (const r of rows) {
    if (!r.kind.endsWith('_redeemed') || !r.orderId) continue;
    const m = minted.get(r.orderId);
    if (!m || m.netPremiumMicro == null) continue; // no mint row in window — skip rather than guess
    const lower = m.lowerTick ?? 0;
    const higher = m.higherTick ?? POS_INF_TICK;
    const lowerUsd = lower <= 0 ? null : tickUsd(lower);
    const higherUsd = higher >= POS_INF_TICK ? null : tickUsd(higher);
    const stake = m.netPremiumMicro;
    const payout = r.payoutMicro ?? BigInt(0);
    out.push({
      orderId: r.orderId,
      marketId: r.marketId,
      dir: lowerUsd != null && higherUsd != null ? 'range' : lowerUsd != null ? 'up' : 'down',
      lowerUsd,
      higherUsd,
      stakeMicro: stake,
      qtyMicro: m.qtyMicro ?? BigInt(0),
      leverageX: (m.leverage1e9 ?? 1_000_000_000) / 1_000_000_000,
      payoutMicro: payout,
      pnlMicro: payout - stake,
      settlementUsd: r.settlementUsd ?? null,
      settledAtMs: r.tsMs,
      expiryMs: null, // the order feed doesn't carry expiry — resolve via market state before rendering

      openedAtMs: m.tsMs,
      mintDigest: m.digest,
      redeemDigest: r.digest,
      kind: r.kind,
    });
  }
  return out; // feed order is newest-first already
}

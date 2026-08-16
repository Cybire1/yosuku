// history729.ts — bet history read from chain, not from an indexer.
//
// Portfolio used to fetch `/managers/{id}/positions` from predict-server.testnet.mystenlabs.com.
// That host no longer resolves at all, so every request failed at DNS, the hook swallowed the
// error, and the page rendered as though you had never placed a bet. Even when it did resolve it
// only ever served 6-24, and the live venue is 7-29.
//
// The durable source is the account's own `PredictData.expiry_summaries` table: one row per
// expiry market with what went in, what came back, fees, and how many positions are still open.
// Two properties matter:
//
//   * it SURVIVES redeem. The venue deletes a Position row when it is claimed, and the redeem
//     keeper claims winners automatically, so reading the positions table shows "no bets" over a
//     winner that already paid out.
//   * it is not events. The testnet event index prunes on a rolling window, so anything older
//     than the floor silently disappears.

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { PREDICT624 } from './predict624Client';

export interface ExpiryHistoryRow {
  /** The expiry market this row summarises. */
  marketId: string;
  /** Micro-DUSDC paid into this expiry (premium + fees). */
  grossPaidMicro: bigint;
  /** Micro-DUSDC received back from it (settlement payouts). */
  grossReceivedMicro: bigint;
  /** Trading fees paid into this expiry, in micro-DUSDC. */
  feesMicro: bigint;
  /** Positions still open here. 0 means the expiry is fully closed out. */
  openCount: number;
  /** received − paid. Negative is a loss. Only meaningful once openCount is 0. */
  netMicro: bigint;
}

const big = (v: unknown): bigint => {
  try { return BigInt(String(v ?? 0)); } catch { return 0n; }
};

/**
 * Read every expiry this account has traded, newest first.
 *
 * Walks the account wrapper's PredictData and lists the `expiry_summaries` table. Returns an
 * empty array for an account that has never traded, which is different from a fetch failing —
 * callers should surface an error rather than an empty state when this throws.
 */
export async function fetchExpiryHistory(
  client: SuiJsonRpcClient,
  wrapperId: string,
): Promise<ExpiryHistoryRow[]> {
  const dfs = await client.getDynamicFields({ parentId: wrapperId });
  const predictData = dfs.data.find((d) =>
    String(d.objectType).includes('predict_account::PredictData'),
  );
  if (!predictData) return [];

  const pd = await client.getDynamicFieldObject({ parentId: wrapperId, name: predictData.name });
  const fields = (pd.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
  const value = (fields.value as { fields?: Record<string, unknown> } | undefined)?.fields ?? fields;
  const summaries = value.expiry_summaries as { fields?: { id?: { id?: string } | string } } | undefined;
  const rawId = summaries?.fields?.id;
  const tableId = typeof rawId === 'string' ? rawId : rawId?.id;
  if (!tableId) return [];

  const rows = await client.getDynamicFields({ parentId: tableId });
  const out: ExpiryHistoryRow[] = [];
  for (const r of rows.data) {
    const entry = await client.getDynamicFieldObject({ parentId: tableId, name: r.name });
    const c = (entry.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
    const v = (c.value as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
    const paid = big(v.gross_paid_to_expiry);
    const received = big(v.gross_received_from_expiry);
    out.push({
      marketId: String((c.name as string | undefined) ?? r.name?.value ?? ''),
      grossPaidMicro: paid,
      grossReceivedMicro: received,
      feesMicro: big(v.trading_fees_paid),
      openCount: Number(big(v.open_position_count)),
      netMicro: received - paid,
    });
  }
  return out;
}

/** Rolled-up totals across every expiry. Only settled rows count toward net. */
export function summarise(rows: ExpiryHistoryRow[]) {
  const settled = rows.filter((r) => r.openCount === 0);
  return {
    marketsTraded: rows.length,
    openMarkets: rows.length - settled.length,
    stakedMicro: rows.reduce((a, r) => a + r.grossPaidMicro, 0n),
    returnedMicro: rows.reduce((a, r) => a + r.grossReceivedMicro, 0n),
    feesMicro: rows.reduce((a, r) => a + r.feesMicro, 0n),
    // Unsettled expiries have received=0 by definition, so folding them in would read as a
    // loss on every open position.
    netSettledMicro: settled.reduce((a, r) => a + r.netMicro, 0n),
    wins: settled.filter((r) => r.netMicro > 0n).length,
    losses: settled.filter((r) => r.netMicro <= 0n).length,
  };
}

export const PREDICT_PKG_FOR_HISTORY = PREDICT624.predictPackage;

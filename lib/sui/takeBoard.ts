// take_board client — the bridge between the deployed discovery contract and the
// feed. Posting builds a one-call PTB (post_take emits TakePosted); reading walks
// the TakePosted event stream and hydrates each take's words from Walrus.
//
// The event is the SOURCE OF TRUTH for the moat: author + the backing position
// (order_id) are on-chain and verifiable. The Walrus blob adds the caption + full
// detail; if a blob can't be fetched, the take still renders from on-chain fields.
//
// Contract: yosuku_takes::take_board @ 0xeb4d4847…06907343 (testnet).
// Proven end-to-end 2026-07-12: Walrus round-trip + post_take tx GiktTnW… emitted
// a TakePosted carrying the blob id.

import { Transaction } from '@mysten/sui/transactions';
import { suiJsonRpc } from './jsonRpc';
import { readTakes, type Take } from './takes';

export const TAKE_BOARD_PKG = '0xeb4d4847d06a11a8ac30c91ca38cda6f690ac902712eef46992a67f706907343';
const POST_TAKE_TARGET = `${TAKE_BOARD_PKG}::take_board::post_take` as const;
const TAKE_POSTED_TYPE = `${TAKE_BOARD_PKG}::take_board::TakePosted` as const;

export type TakeSide = 0 | 1 | 2; // 0 up · 1 down · 2 range

/** One take as the feed consumes it: on-chain proof fields + hydrated Walrus words. */
export interface FeedTake {
  // ── on-chain (TakePosted) — the verifiable spine ──
  author: string;
  blobId: string;
  marketId: string;
  orderId: string; // '0' = a call with no bet linked
  side: TakeSide;
  strikeUsd: number;
  tsMs: number;
  digest: string | null; // the post tx — "verify on Suiscan"
  backed: boolean; // orderId !== '0' → shows the "✓ position" badge
  // ── hydrated from Walrus (best-effort) ──
  caption?: string;
  lowerUsd?: number;
  higherUsd?: number;
  stakeDusdc?: number;
  cadence?: string;
  expiryMs?: number;
}

/** Build the post-a-take transaction. Gas-free via the sponsor when the target is
 *  allow-listed, else wallet-paid — pass through useSmartSubmit like every write. */
export function buildPostTakeTx(a: {
  blobId: string;
  marketId: string;
  orderId: string; // decimal string; '0' when no bet is linked
  side: TakeSide;
  strikeUsd: number;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: POST_TAKE_TARGET,
    arguments: [
      tx.pure.string(a.blobId),
      tx.pure.address(a.marketId),
      tx.pure.u256(BigInt(a.orderId || '0')),
      tx.pure.u8(a.side),
      tx.pure.u64(BigInt(Math.max(0, Math.round(a.strikeUsd)))),
      tx.object('0x6'), // Clock
    ],
  });
  return tx;
}

type RpcEvent = {
  timestampMs?: string;
  parsedJson?: Record<string, unknown>;
  id?: { txDigest?: string };
};

const asStr = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const asNum = (v: unknown): number => Number((v as string | number) ?? 0);

function clampSide(v: unknown): TakeSide {
  const n = asNum(v);
  return n === 1 ? 1 : n === 2 ? 2 : 0;
}

/**
 * Recent takes, newest first. Reads the TakePosted stream, then hydrates captions
 * from Walrus in parallel. On-chain fields always populate; the Walrus caption
 * enriches when the blob resolves.
 */
export async function fetchTakes(limit = 40): Promise<FeedTake[]> {
  let events: RpcEvent[] = [];
  try {
    const res = await suiJsonRpc<{ data?: RpcEvent[] }>('suix_queryEvents', [
      { MoveEventType: TAKE_POSTED_TYPE },
      null,
      Math.min(50, limit),
      true, // descending → newest first
    ]);
    events = res?.data ?? [];
  } catch {
    return [];
  }

  const takes: FeedTake[] = events.map((e) => {
    const j = e.parsedJson ?? {};
    const orderId = asStr(j.order_id) || '0';
    return {
      author: asStr(j.author),
      blobId: asStr(j.blob_id),
      marketId: asStr(j.market_id),
      orderId,
      side: clampSide(j.side),
      strikeUsd: asNum(j.strike_usd),
      tsMs: asNum(j.ts_ms) || (e.timestampMs ? Number(e.timestampMs) : 0),
      digest: e.id?.txDigest ?? null,
      backed: orderId !== '0',
    };
  });

  // hydrate captions from Walrus (best-effort; failures leave on-chain fields intact)
  const hydrated = await readTakes(takes.map((t) => t.blobId));
  const byBlob = new Map<string, Take>(hydrated.map((h) => [h.blobId, h]));
  for (const t of takes) {
    const h = byBlob.get(t.blobId);
    if (!h) continue;
    t.caption = h.caption;
    t.lowerUsd = h.lowerUsd;
    t.higherUsd = h.higherUsd;
    t.stakeDusdc = h.stakeDusdc;
    t.cadence = h.cadence;
    t.expiryMs = h.expiryMs;
  }
  return takes;
}

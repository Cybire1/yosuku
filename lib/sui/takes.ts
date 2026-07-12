// "Post a take" — the content layer, on Walrus.
//
// A take is a public, durable social post backed by a REAL on-chain position: the
// user's call ("BTC under $64,316"), their thesis in words, and a pointer to the
// 6-24 market. The moat is that every take has skin in the game — the position is
// on-chain and verifiable; the words live on Walrus so they're un-rug-able and no
// central server owns them. Discovery is a `TakePosted` event (see the take_board
// Move module) that carries the Walrus blobId; the feed reads events → hydrates
// each take from here.
//
// This module is deliberately transport-only: PUT the JSON to a Walrus publisher,
// GET it back from an aggregator. Reads reuse the same aggregator the Memory
// Market already uses in production (lib/sui/memoryMarketClient.ts).

// Public Walrus testnet endpoints (same aggregator the app already reads from).
const WALRUS_PUBLISHER = 'https://publisher.walrus-testnet.walrus.space/v1/blobs';
const WALRUS_AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space/v1/blobs';

// How long the blob is paid to live (Walrus epochs ≈ 1 day on testnet). A take is
// a durable record of a call, so keep it well past the market's settlement.
const TAKE_EPOCHS = 30;

export const TAKE_MAX_CAPTION = 240; // one confident sentence, not an essay

/** The take as stored on Walrus. `v` gates forward-compatible schema changes. */
export interface Take {
  v: 1;
  author: string; // wallet address that posted
  kind: 'dir' | 'range';
  dir?: 'up' | 'down';
  strikeUsd?: number;
  lowerUsd?: number;
  higherUsd?: number;
  marketId: string; // the 6-24 market the call is on
  orderId?: string; // the backing position (proof of skin-in-the-game), if placed
  stakeDusdc?: number;
  caption: string; // the user's thesis
  cadence?: string; // '1m' | '5m' | '1h'
  expiryMs: number; // the bell
  ts: number; // client post time (the on-chain event carries the canonical ts)
}

/** A take joined to its Walrus blob id — what the feed renders. */
export interface HydratedTake extends Take {
  blobId: string;
}

/** Trim + hard-cap the caption so a take stays a take, never an essay. */
export function normalizeCaption(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, TAKE_MAX_CAPTION);
}

/** The exact bytes we persist — a stable, minimal JSON (drops undefined fields). */
export function serializeTake(take: Take): string {
  // JSON.stringify already omits undefined values; this keeps the blob compact
  // and deterministic so identical takes dedupe to the same content.
  return JSON.stringify(take);
}

/**
 * Write a take to Walrus. Returns the blobId to record on-chain via take_board.
 * Publisher PUT is a plain HTTP upload — no wallet/gas (the publisher sponsors
 * the storage), which keeps posting a take gas-free like the rest of the app.
 */
export async function writeTake(take: Take, opts?: { signal?: AbortSignal }): Promise<{ blobId: string }> {
  const body = serializeTake(take);
  const res = await fetch(`${WALRUS_PUBLISHER}?epochs=${TAKE_EPOCHS}`, {
    method: 'PUT',
    body,
    signal: opts?.signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Walrus publisher rejected the take (${res.status})`);
  }
  const json = await res.json();
  // Publisher returns either a freshly stored blob or an already-certified one.
  const blobId: string | undefined =
    json?.newlyCreated?.blobObject?.blobId ?? json?.alreadyCertified?.blobId;
  if (!blobId) {
    throw new Error('Walrus publisher returned no blobId');
  }
  return { blobId };
}

/**
 * Read one take back from Walrus by blobId and validate its shape. Throws on a
 * missing/garbled blob so the feed can skip it rather than render junk.
 */
export async function readTake(blobId: string, opts?: { signal?: AbortSignal }): Promise<HydratedTake> {
  const res = await fetch(`${WALRUS_AGGREGATOR}/${encodeURIComponent(blobId)}`, {
    signal: opts?.signal ?? AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Couldn't fetch the take from Walrus (${res.status})`);
  }
  const raw = await res.json();
  if (!isTake(raw)) {
    throw new Error('Blob is not a valid take');
  }
  return { ...raw, blobId };
}

/** Hydrate many takes in parallel; drop any that fail rather than fail the feed. */
export async function readTakes(blobIds: string[]): Promise<HydratedTake[]> {
  const settled = await Promise.allSettled(blobIds.map((id) => readTake(id)));
  return settled
    .filter((r): r is PromiseFulfilledResult<HydratedTake> => r.status === 'fulfilled')
    .map((r) => r.value);
}

/** Structural guard — every field the renderer relies on must be present + typed. */
function isTake(x: unknown): x is Take {
  if (!x || typeof x !== 'object') return false;
  const t = x as Record<string, unknown>;
  return (
    t.v === 1 &&
    typeof t.author === 'string' &&
    (t.kind === 'dir' || t.kind === 'range') &&
    typeof t.marketId === 'string' &&
    typeof t.caption === 'string' &&
    typeof t.expiryMs === 'number' &&
    typeof t.ts === 'number'
  );
}

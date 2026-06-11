// Strategy Marketplace — read listings + build the purchase PTB.
// Verifiable trading knowledge sold trustlessly: a Seal-encrypted playbook on
// Walrus, gated by an on-chain `seal_approve` paywall. This module is the
// browser side (reads + the purchase transaction); decryption runs server-side
// (it needs @mysten/seal) via /api/market/unlock.
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { DUSDC_TYPE, CLOCK_ID } from './constants';

export const MARKET_PKG = '0x8b2f0931f0bf1b55385bb2d2322c14fc61ba7d9e8f43ff20f7bd37794fc8ca9e';
export const MARKET_ID = '0x5bde72a992105011e851abd8f96026c27fc97440ac4db0a1f1356252b58be7dc';
export const WALRUS_AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space';

const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });

export interface ProvenanceManifest {
  strategist: string;
  agent?: string;
  provenance?: string[]; // tx digests backing the playbook
  realized?: { trades?: number; openCost?: string; note?: string };
  lessonCount?: number;
}

export interface Listing {
  id: string;
  strategist: string;
  title: string;
  priceDusdc: number; // human DUSDC
  priceRaw: bigint;
  accessMs: number; // 0 = perpetual
  totalSales: number;
  active: boolean;
  manifestBlobId: string; // u256 as decimal string
  playbookBlobId: string;
  manifest?: ProvenanceManifest | null;
}

/** u256 (decimal string) -> base64url Walrus blob id. */
function u256ToBlobId(dec: string): string {
  let hex = BigInt(dec).toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function fetchManifest(manifestBlobIdDec: string): Promise<ProvenanceManifest | null> {
  if (manifestBlobIdDec === '0') return null;
  try {
    const blobId = u256ToBlobId(manifestBlobIdDec);
    const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
    if (!res.ok) return null;
    return (await res.json()) as ProvenanceManifest;
  } catch {
    return null;
  }
}

function parseListing(id: string, fields: Record<string, unknown>): Listing {
  const priceRaw = BigInt((fields.price as string) ?? '0');
  return {
    id,
    strategist: fields.strategist as string,
    title: (fields.title as string) ?? 'Untitled strategy',
    priceRaw,
    priceDusdc: Number(priceRaw) / 1_000_000,
    accessMs: Number((fields.access_ms as string) ?? '0'),
    totalSales: Number((fields.total_sales as string) ?? '0'),
    active: Boolean(fields.active),
    manifestBlobId: (fields.manifest_blob_id as string) ?? '0',
    playbookBlobId: (fields.playbook_blob_id as string) ?? '0',
  };
}

/** Enumerate all listings via the `Listed` event, then read current state. */
export async function getListings(): Promise<Listing[]> {
  const events = await client.queryEvents({
    query: { MoveEventType: `${MARKET_PKG}::strategy_market::Listed` },
    order: 'descending',
    limit: 50,
  });
  const ids = [...new Set(events.data.map((e) => (e.parsedJson as { listing_id: string }).listing_id))];
  if (ids.length === 0) return [];

  const objs = await client.multiGetObjects({ ids, options: { showContent: true } });
  const listings = objs
    .map((o) => {
      const content = o.data?.content;
      if (!content || content.dataType !== 'moveObject') return null;
      return parseListing(o.data!.objectId, content.fields as Record<string, unknown>);
    })
    .filter((l): l is Listing => l !== null && l.active);

  // attach provenance manifests
  await Promise.all(
    listings.map(async (l) => {
      l.manifest = await fetchManifest(l.manifestBlobId);
    }),
  );
  return listings;
}

export async function getListing(id: string): Promise<Listing | null> {
  const o = await client.getObject({ id, options: { showContent: true } });
  const content = o.data?.content;
  if (!content || content.dataType !== 'moveObject') return null;
  const listing = parseListing(id, content.fields as Record<string, unknown>);
  listing.manifest = await fetchManifest(listing.manifestBlobId);
  return listing;
}

/** True iff `address` has unexpired access to the listing (devInspect of has_access). */
export async function hasAccess(listingId: string, address: string): Promise<boolean> {
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${MARKET_PKG}::strategy_market::has_access`,
      typeArguments: [DUSDC_TYPE],
      arguments: [tx.object(listingId), tx.pure.address(address), tx.object(CLOCK_ID)],
    });
    const res = await client.devInspectTransactionBlock({
      sender: address,
      transactionBlock: tx,
    });
    const ret = res.results?.[0]?.returnValues?.[0];
    return !!ret && ret[0]?.[0] === 1; // bool true
  } catch {
    return false;
  }
}

/** Build the purchase PTB: split exact price from the buyer's DUSDC, call purchase. */
export async function buildPurchaseTx(buyer: string, listing: Listing): Promise<Transaction> {
  const coins = await client.getCoins({ owner: buyer, coinType: DUSDC_TYPE });
  if (coins.data.length === 0) throw new Error('No DUSDC. Get test chips first.');

  const tx = new Transaction();
  // merge all DUSDC coins into the first, then split the exact price
  const [primary, ...rest] = coins.data.map((c) => tx.object(c.coinObjectId));
  if (rest.length) tx.mergeCoins(primary, rest);
  const [payment] = tx.splitCoins(primary, [listing.priceRaw]);

  tx.moveCall({
    target: `${MARKET_PKG}::strategy_market::purchase`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(MARKET_ID), tx.object(listing.id), payment, tx.object(CLOCK_ID)],
  });
  return tx;
}

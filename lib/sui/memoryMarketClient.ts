// Memory Market client — an agent's MemWal memory as a priced, tradable on-chain asset.
// Buy a MemoryPass (the transferable on-chain asset) → the creator earns; the pass holder can
// Seal-decrypt the agent's playbook capsule in-browser (readMemory, gated by memory_market::
// seal_approve). Reads via JSON-RPC (reliable; the GraphQL event index lags — same as strategyClient).
import { suiJsonRpc } from './jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { SealClient, SessionKey } from '@mysten/seal';
import { grpc } from './modernClients';
import { fromHex } from '@mysten/sui/utils';
import { DUSDC_MULTIPLIER } from './constants';

// Hardened pkg (admin-gated listing + exact-price/refund). Replaces 0x71598871 (open-listing flaw).
export const MEMORY_MARKET_PKG = '0x601895033b49cf24935f76a5ad796be8e8b93b91fa85ee89671d4405c7ed6061';
const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const MEMORY_LISTED = `${MEMORY_MARKET_PKG}::memory_market::MemoryListed`;
const PASS_TYPE = `${MEMORY_MARKET_PKG}::memory_market::MemoryPass`;
const SEAL_SERVERS = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
];
const WALRUS_AGG = 'https://aggregator.walrus-testnet.walrus.space/v1/blobs';
// Seal-encrypted playbook capsules per listing (seal identity = the listing id; blob on Walrus).
// Off-chain map for the curated beta; production: store the blob id on the listing.
const CAPSULES: Record<string, string> = {
  '0x0a4958cec2e2289e86b4ec99df558ac2a745d0d95874c560842d108c645bbcb1': 'zSaNpUhNm7FkBMtMxW38XQnnUF0axn7f2E8mjPndTfA',
};
type SignPersonalMessage = (input: { message: Uint8Array }) => Promise<{ signature: string }>;

async function rpc<T = any>(method: string, params: unknown[]): Promise<T> {
  return suiJsonRpc<T>(method, params); // resilient multi-node — the public fullnode's JSON-RPC 404s
}

export type MemoryMarketInfo = {
  listingId: string;
  creator: string;
  memoryAccount: string;
  price: number; // DUSDC
  passesSold: number;
  ownsPass: boolean;
  passId: string | null; // the owner's pass object (for Seal decrypt), if held
  hasCapsule: boolean;   // an encrypted playbook capsule exists for this listing
};

/** The memory listing for a strategy (or null if its memory isn't for sale), + whether `owner` holds a pass. */
export async function fetchMemoryMarket(strategyId: string, owner: string | null): Promise<MemoryMarketInfo | null> {
  try {
    // find the listing for this strategy, paginating MemoryListed events (admin-gated, so all
    // listings are vetted; pagination keeps older ones discoverable as volume grows).
    let listingId: string | null = null;
    let cursor: unknown = null;
    for (let page = 0; page < 10 && !listingId; page++) {
      const ev = await rpc<{ data?: Array<{ parsedJson?: Record<string, any> }>; hasNextPage?: boolean; nextCursor?: unknown }>(
        'suix_queryEvents', [{ MoveEventType: MEMORY_LISTED }, cursor, 50, true],
      );
      const node = (ev?.data ?? []).find((e) => e.parsedJson?.strategy === strategyId);
      if (node?.parsedJson?.listing) listingId = String(node.parsedJson.listing);
      if (!ev?.hasNextPage) break;
      cursor = ev.nextCursor;
    }
    if (!listingId) return null;

    const obj = await rpc<{ data?: { content?: { fields?: Record<string, any> } } }>(
      'sui_getObject', [listingId, { showContent: true }],
    );
    const f = obj?.data?.content?.fields;
    if (!f) return null;

    // ownsPass: paginate owned MemoryPass objects so a pass past the first page isn't missed (→ no double-buy).
    let ownsPass = false;
    let passId: string | null = null;
    if (owner) {
      let pc: unknown = null;
      for (let page = 0; page < 10 && !ownsPass; page++) {
        const owned = await rpc<{ data?: Array<{ data?: { objectId?: string; content?: { fields?: Record<string, any> } } }>; hasNextPage?: boolean; nextCursor?: unknown }>(
          'suix_getOwnedObjects', [owner, { filter: { StructType: PASS_TYPE }, options: { showContent: true } }, pc, 50],
        );
        const match = (owned?.data ?? []).find((o) => o.data?.content?.fields?.listing === listingId);
        if (match) { ownsPass = true; passId = match.data?.objectId ?? null; }
        if (!owned?.hasNextPage) break;
        pc = owned.nextCursor;
      }
    }

    return {
      listingId,
      creator: String(f.creator),
      memoryAccount: String(f.memory_account),
      price: Number(f.price) / DUSDC_MULTIPLIER,
      passesSold: Number(f.passes_sold),
      ownsPass,
      passId,
      hasCapsule: !!CAPSULES[listingId],
    };
  } catch {
    return null;
  }
}

/** One card in the Marketplace storefront — an agent's memory offered for sale. */
export type MemoryListingCard = {
  listingId: string;
  strategy: string;      // the Strategy object this memory belongs to (match to a StrategyCard for its record)
  creator: string;
  memoryAccount: string;
  price: number;         // DUSDC
  passesSold: number;
  ownsPass: boolean;
  passId: string | null;
  hasCapsule: boolean;   // an encrypted playbook exists (readable once you hold a pass)
};

/** Discover EVERY memory listing for the Marketplace storefront (admin-vetted, so all are safe). */
export async function fetchAllMemoryListings(owner: string | null): Promise<MemoryListingCard[]> {
  try {
    // 1) every MemoryListed event → listing meta (dedupe by listing id, newest first)
    const meta = new Map<string, { strategy: string; creator: string; memoryAccount: string }>();
    let cursor: unknown = null;
    for (let page = 0; page < 10; page++) {
      const ev = await rpc<{ data?: Array<{ parsedJson?: Record<string, any> }>; hasNextPage?: boolean; nextCursor?: unknown }>(
        'suix_queryEvents', [{ MoveEventType: MEMORY_LISTED }, cursor, 50, true],
      );
      for (const e of ev?.data ?? []) {
        const j = e.parsedJson;
        if (j?.listing && !meta.has(String(j.listing))) {
          meta.set(String(j.listing), { strategy: String(j.strategy), creator: String(j.creator), memoryAccount: String(j.memory_account) });
        }
      }
      if (!ev?.hasNextPage) break;
      cursor = ev.nextCursor;
    }
    const ids = [...meta.keys()];
    if (!ids.length) return [];

    // 2) current on-chain state of each listing (price + passes_sold) — one multiGet
    const objs = await rpc<Array<{ data?: { objectId?: string; content?: { fields?: Record<string, any> } } }>>(
      'sui_multiGetObjects', [ids, { showContent: true }],
    );
    const state = new Map<string, { price: number; passesSold: number }>();
    for (const o of objs ?? []) {
      const id = o.data?.objectId; const f = o.data?.content?.fields;
      if (id && f) state.set(id, { price: Number(f.price) / DUSDC_MULTIPLIER, passesSold: Number(f.passes_sold) });
    }

    // 3) which listings the connected wallet already holds a pass to (one paginated owned query)
    const owned = new Map<string, string>();
    if (owner) {
      let pc: unknown = null;
      for (let page = 0; page < 10; page++) {
        const r = await rpc<{ data?: Array<{ data?: { objectId?: string; content?: { fields?: Record<string, any> } } }>; hasNextPage?: boolean; nextCursor?: unknown }>(
          'suix_getOwnedObjects', [owner, { filter: { StructType: PASS_TYPE }, options: { showContent: true } }, pc, 50],
        );
        for (const o of r?.data ?? []) {
          const l = o.data?.content?.fields?.listing;
          if (l && !owned.has(String(l))) owned.set(String(l), o.data!.objectId!);
        }
        if (!r?.hasNextPage) break;
        pc = r.nextCursor;
      }
    }

    return ids
      .map((id): MemoryListingCard => {
        const m = meta.get(id)!; const st = state.get(id);
        return {
          listingId: id, strategy: m.strategy, creator: m.creator, memoryAccount: m.memoryAccount,
          price: st?.price ?? 0, passesSold: st?.passesSold ?? 0,
          ownsPass: owned.has(id), passId: owned.get(id) ?? null, hasCapsule: !!CAPSULES[id],
        };
      })
      .filter((l) => l.price > 0); // drop any half-created/broken listing
  } catch {
    return [];
  }
}

/** Buy a MemoryPass: split exactly the price, call buy_pass, keep the pass. */
export function buildBuyPassTx(p: { listingId: string; coinIds: string[]; priceMicro: bigint; owner: string }): Transaction {
  const tx = new Transaction();
  const primary = tx.object(p.coinIds[0]);
  if (p.coinIds.length > 1) tx.mergeCoins(primary, p.coinIds.slice(1).map((id) => tx.object(id)));
  const [pay] = tx.splitCoins(primary, [p.priceMicro]);
  const pass = tx.moveCall({
    target: `${MEMORY_MARKET_PKG}::memory_market::buy_pass`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(p.listingId), pay],
  });
  tx.transferObjects([pass], tx.pure.address(p.owner));
  return tx;
}

/** Pass-holder: Seal-decrypt the agent's playbook capsule in-browser (gated by memory_market::seal_approve). */
export async function readMemory(opts: {
  suiClient: any;
  walletAddress: string;
  listingId: string;
  passId: string;
  signPersonalMessage: SignPersonalMessage;
}): Promise<string> {
  const { walletAddress, listingId, passId, signPersonalMessage } = opts; // Seal needs a `.core` client — use the gRPC client, not the wallet's JSON-RPC shim
  const blobId = CAPSULES[listingId];
  if (!blobId) throw new Error('No encrypted playbook for this listing yet.');
  const sealClient = new SealClient({ suiClient: grpc, serverConfigs: SEAL_SERVERS.map((objectId) => ({ objectId, weight: 1 })), verifyKeyServers: false });
  const r = await fetch(`${WALRUS_AGG}/${blobId}`);
  if (!r.ok) throw new Error(`Couldn't fetch the playbook from Walrus (${r.status}).`);
  const ct = new Uint8Array(await r.arrayBuffer());
  const sessionKey = await SessionKey.create({ address: walletAddress, packageId: MEMORY_MARKET_PKG, ttlMin: 10, suiClient: grpc });
  const { signature } = await signPersonalMessage({ message: sessionKey.getPersonalMessage() });
  await sessionKey.setPersonalMessageSignature(signature);
  const tx = new Transaction();
  tx.setSender(walletAddress); // owned-object (pass) resolution needs the real sender even for kind-only builds
  tx.moveCall({
    target: `${MEMORY_MARKET_PKG}::memory_market::seal_approve`,
    arguments: [tx.pure.vector('u8', fromHex(listingId.slice(2))), tx.object(passId)],
  });
  const txBytes = await tx.build({ client: grpc, onlyTransactionKind: true });
  const dec = await sealClient.decrypt({ data: ct, sessionKey, txBytes });
  return new TextDecoder().decode(dec);
}

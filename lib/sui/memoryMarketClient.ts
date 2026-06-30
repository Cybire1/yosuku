// Memory Market client — an agent's MemWal memory as a priced, tradable on-chain asset.
// Buy a MemoryPass (the transferable on-chain asset) → the creator earns; the pass holder can
// Seal-decrypt the agent's playbook capsule in-browser (readMemory, gated by memory_market::
// seal_approve). Reads via JSON-RPC (reliable; the GraphQL event index lags — same as strategyClient).
import { Transaction } from '@mysten/sui/transactions';
import { SealClient, SessionKey } from '@mysten/seal';
import { fromHex } from '@mysten/sui/utils';
import { DUSDC_MULTIPLIER } from './constants';

// Hardened pkg (admin-gated listing + exact-price/refund). Replaces 0x71598871 (open-listing flaw).
export const MEMORY_MARKET_PKG = '0x601895033b49cf24935f76a5ad796be8e8b93b91fa85ee89671d4405c7ed6061';
const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const RPC_URL = process.env.NEXT_PUBLIC_SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443';
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
  const r = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await r.json())?.result as T;
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
  const { suiClient, walletAddress, listingId, passId, signPersonalMessage } = opts;
  const blobId = CAPSULES[listingId];
  if (!blobId) throw new Error('No encrypted playbook for this listing yet.');
  const sealClient = new SealClient({ suiClient, serverConfigs: SEAL_SERVERS.map((objectId) => ({ objectId, weight: 1 })), verifyKeyServers: false });
  const r = await fetch(`${WALRUS_AGG}/${blobId}`);
  if (!r.ok) throw new Error(`Couldn't fetch the playbook from Walrus (${r.status}).`);
  const ct = new Uint8Array(await r.arrayBuffer());
  const sessionKey = await SessionKey.create({ address: walletAddress, packageId: MEMORY_MARKET_PKG, ttlMin: 10, suiClient });
  const { signature } = await signPersonalMessage({ message: sessionKey.getPersonalMessage() });
  await sessionKey.setPersonalMessageSignature(signature);
  const tx = new Transaction();
  tx.moveCall({
    target: `${MEMORY_MARKET_PKG}::memory_market::seal_approve`,
    arguments: [tx.pure.vector('u8', fromHex(listingId.slice(2))), tx.object(passId)],
  });
  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });
  const dec = await sealClient.decrypt({ data: ct, sessionKey, txBytes });
  return new TextDecoder().decode(dec);
}

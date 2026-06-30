// Memory Market client — an agent's MemWal memory listed as a priced, tradable on-chain asset.
// Buy a MemoryPass (the transferable asset) → the creator earns, you unlock the playbook.
// Pkg deployed + proven on testnet (memory_market::memory_market). Reads via JSON-RPC (reliable;
// the GraphQL event index lags — same reason strategyClient falls back to JSON-RPC).
import { Transaction } from '@mysten/sui/transactions';
import { DUSDC_MULTIPLIER } from './constants';

// Hardened pkg (admin-gated listing + exact-price/refund). Replaces 0x71598871 (open-listing flaw).
export const MEMORY_MARKET_PKG = '0x601895033b49cf24935f76a5ad796be8e8b93b91fa85ee89671d4405c7ed6061';
const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const RPC_URL = process.env.NEXT_PUBLIC_SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443';
const MEMORY_LISTED = `${MEMORY_MARKET_PKG}::memory_market::MemoryListed`;
const PASS_TYPE = `${MEMORY_MARKET_PKG}::memory_market::MemoryPass`;

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
    if (owner) {
      let pc: unknown = null;
      for (let page = 0; page < 10 && !ownsPass; page++) {
        const owned = await rpc<{ data?: Array<{ data?: { content?: { fields?: Record<string, any> } } }>; hasNextPage?: boolean; nextCursor?: unknown }>(
          'suix_getOwnedObjects', [owner, { filter: { StructType: PASS_TYPE }, options: { showContent: true } }, pc, 50],
        );
        if ((owned?.data ?? []).some((o) => o.data?.content?.fields?.listing === listingId)) ownsPass = true;
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

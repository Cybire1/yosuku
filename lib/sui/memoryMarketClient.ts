// Memory Market client — an agent's MemWal memory listed as a priced, tradable on-chain asset.
// Buy a MemoryPass (the transferable asset) → the creator earns, you unlock the playbook.
// Pkg deployed + proven on testnet (memory_market::memory_market). Reads via JSON-RPC (reliable;
// the GraphQL event index lags — same reason strategyClient falls back to JSON-RPC).
import { Transaction } from '@mysten/sui/transactions';
import { DUSDC_MULTIPLIER } from './constants';

export const MEMORY_MARKET_PKG = '0x715988713ec0c8878d1bd948d55126a011c9a06811325d99f9ea8aafcf015418';
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
    const ev = await rpc<{ data?: Array<{ parsedJson?: Record<string, any> }> }>(
      'suix_queryEvents', [{ MoveEventType: MEMORY_LISTED }, null, 50, true],
    );
    const node = (ev?.data ?? []).find((e) => e.parsedJson?.strategy === strategyId);
    if (!node?.parsedJson?.listing) return null;
    const listingId = String(node.parsedJson.listing);

    const obj = await rpc<{ data?: { content?: { fields?: Record<string, any> } } }>(
      'sui_getObject', [listingId, { showContent: true }],
    );
    const f = obj?.data?.content?.fields;
    if (!f) return null;

    let ownsPass = false;
    if (owner) {
      const owned = await rpc<{ data?: Array<{ data?: { content?: { fields?: Record<string, any> } } }> }>(
        'suix_getOwnedObjects', [owner, { filter: { StructType: PASS_TYPE }, options: { showContent: true } }],
      );
      ownsPass = (owned?.data ?? []).some((o) => o.data?.content?.fields?.listing === listingId);
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

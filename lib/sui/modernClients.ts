// Modern Sui data layer — OFF JSON-RPC.
//
// Sui is sunsetting JSON-RPC (~Jul 2026) in favour of GraphQL (reads) + gRPC
// (simulate/execute). This module is the single backbone for that migration:
//
//   • `gql`  — SuiGraphQLClient (reads: balances, coins, objects, owned objects,
//              dynamic fields, events, transaction history).
//   • `grpc` — SuiGrpcClient (simulate for Move-call return values, execute, wait).
//   • `readClient` — a thin COMPAT SHIM that presents the old JSON-RPC method names
//     (`getBalance`/`getCoins`/`getObject`/…) backed by GraphQL/gRPC, so call sites
//     barely change. NOTE: object reads return Move fields WITHOUT JSON-RPC's `.fields`
//     nesting wrapper — GraphQL `json` gives struct fields directly (e.g.
//     `content.fields.vault.balance`, not `…vault.fields.balance`). Adjust nested paths.
//
// dapp-kit (1.0.6) is hard-typed to JSON-RPC for wallet plumbing, so its SuiClientProvider
// keeps a JSON-RPC client purely for the wallet adapter — but our DATA PATH (every read +
// every execute) runs entirely on GraphQL/gRPC via this module.

import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { fromBase64 } from '@mysten/sui/utils';
import type { Transaction } from '@mysten/sui/transactions';

export const GRAPHQL_URL = process.env.NEXT_PUBLIC_SUI_GRAPHQL_URL || 'https://graphql.testnet.sui.io/graphql';
export const GRPC_URL = process.env.NEXT_PUBLIC_SUI_GRPC_URL || 'https://fullnode.testnet.sui.io:443';

export const gql = new SuiGraphQLClient({ url: GRAPHQL_URL, network: 'testnet' });
export const grpc = new SuiGrpcClient({ network: 'testnet', baseUrl: GRPC_URL });

// ─── helpers ───

const decodeU64 = (bytes: Uint8Array | number[]): bigint => {
  let v = BigInt(0);
  Array.from(bytes).forEach((b, i) => (v |= BigInt(b) << (BigInt(8) * BigInt(i))));
  return v;
};

// Shapes the compat shim returns (mirror the JSON-RPC surface the call sites expect,
// minus the per-struct `.fields` nesting wrapper — see file header).
type ShimContent = { dataType: string; type?: string; fields: Record<string, unknown> | null };
type ShimObject = { data: { objectId: string; content: ShimContent } };

/** Read a Move view's u64 return values via gRPC simulation (replaces devInspect). */
export async function simulateReturnU64s(tx: Transaction, sender: string, commandIndex = -1): Promise<bigint[]> {
  tx.setSenderIfNotSet(sender);
  const res = await grpc.simulateTransaction({ transaction: tx, include: { commandResults: true } });
  const cmds = res.commandResults ?? [];
  const cmd = commandIndex < 0 ? cmds.at(commandIndex) : cmds[commandIndex];
  return (cmd?.returnValues ?? []).map((rv) => decodeU64(rv.bcs));
}

/** Raw boolean return (1 byte) from a simulated command (replaces devInspect bool reads). */
export async function simulateReturnBool(tx: Transaction, sender: string, commandIndex = 0): Promise<boolean> {
  tx.setSenderIfNotSet(sender);
  const res = await grpc.simulateTransaction({ transaction: tx, include: { commandResults: true } });
  const rv = res.commandResults?.[commandIndex]?.returnValues?.[0]?.bcs;
  return !!rv && rv[0] === 1;
}

/**
 * Build (via gRPC) → sign (via the wallet) → execute (via gRPC). The whole path is
 * off JSON-RPC; the wallet only signs. `signTransaction` is dapp-kit's
 * `useSignTransaction().mutateAsync`. Returns the digest + inline effects/events.
 */
export async function buildSignExecute(
  tx: Transaction,
  signTransaction: (input: { transaction: Transaction }) => Promise<{ bytes: string; signature: string }>,
): Promise<{ digest: string; events: any[]; objectTypes: Record<string, string> }> {
  // The wallet builds + signs and returns the EXACT bytes it signed — execute those via
  // gRPC (no rebuild, or the signature wouldn't match). The execute path is off JSON-RPC.
  const { bytes, signature } = await signTransaction({ transaction: tx });
  const res = await grpc.executeTransaction({
    transaction: fromBase64(bytes),
    signatures: [signature],
    include: { effects: true, events: true, objectTypes: true },
  });
  const t = (res as any).Transaction ?? (res as any).FailedTransaction;
  if (!t?.status?.success) throw new Error(JSON.stringify(t?.status?.error ?? 'transaction failed'));
  return { digest: t.digest, events: t.events ?? [], objectTypes: t.objectTypes ?? {} };
}

// ─── GraphQL raw queries (events + tx history aren't in the unified core API) ───

const EVENTS_Q = `query Events($type: String!, $last: Int!) {
  events(last: $last, filter: { type: $type }) {
    nodes { sender { address } contents { json } }
  }
}`;

const TXS_FROM_Q = `query TxsFrom($addr: SuiAddress!, $last: Int!) {
  transactions(last: $last, filter: { sentAddress: $addr }) {
    nodes {
      effects {
        timestamp
        balanceChanges { nodes { amount coinType { repr } owner { address } } }
      }
    }
  }
}`;

// ─── COMPAT SHIM: the old JSON-RPC surface, backed by GraphQL/gRPC ───

export const readClient = {
  async getBalance({ owner, coinType }: { owner: string; coinType?: string }) {
    const r = await gql.getBalance({ owner, coinType: coinType ?? '0x2::sui::SUI' });
    return { totalBalance: r.balance?.balance ?? '0', coinType: coinType ?? '0x2::sui::SUI' };
  },

  async getCoins({ owner, coinType }: { owner: string; coinType: string }) {
    const r = await gql.listCoins({ owner, coinType });
    return { data: (r.objects ?? []).map((c) => ({ coinObjectId: c.objectId, balance: c.balance })) };
  },

  async getObject({ id, options: _options }: { id: string; options?: { showContent?: boolean } }): Promise<ShimObject> {
    const r = await gql.getObject({ objectId: id, include: { json: true } });
    const o = (r as any).object ?? r;
    return { data: { objectId: id, content: { dataType: 'moveObject', type: o?.type, fields: (o?.json ?? null) as Record<string, unknown> | null } } };
  },

  async multiGetObjects({ ids, options: _options }: { ids: string[]; options?: { showContent?: boolean } }): Promise<ShimObject[]> {
    const r = await gql.getObjects({ objectIds: ids, include: { json: true } });
    const objs = ((r as any).objects ?? r ?? []) as any[];
    return objs.map((o) => ({ data: { objectId: o?.objectId as string, content: { dataType: 'moveObject', type: o?.type, fields: (o?.json ?? null) as Record<string, unknown> | null } } }));
  },

  async getOwnedObjects({ owner, filter, options: _options }: { owner: string; filter?: { StructType?: string }; options?: { showContent?: boolean } }): Promise<{ data: ShimObject[] }> {
    const r = await gql.listOwnedObjects({ owner, type: filter?.StructType, include: { json: true } });
    const objs = ((r as any).objects ?? []) as any[];
    return { data: objs.map((o) => ({ data: { objectId: o?.objectId as string, content: { dataType: 'moveObject', type: o?.type, fields: (o?.json ?? null) as Record<string, unknown> | null } } })) };
  },

  async getDynamicFields({ parentId }: { parentId: string }) {
    const r = await gql.listDynamicFields({ parentId });
    return { data: (r.dynamicFields ?? []).map((f: any) => ({ name: { type: f.name?.type }, objectId: f.childId ?? f.fieldId, type: f.type })) };
  },

  async queryEvents({ query, limit = 50 }: { query: { MoveEventType: string }; order?: string; limit?: number }) {
    const { data, errors } = await gql.query<{ events: { nodes: Array<{ sender: { address: string }; contents: { json: any } }> } }>({
      query: EVENTS_Q,
      variables: { type: query.MoveEventType, last: limit },
    });
    if (errors?.length) throw new Error(errors[0].message);
    // `last` returns ascending; reverse for descending (newest first) to match JSON-RPC.
    return { data: (data?.events?.nodes ?? []).reverse().map((n) => ({ parsedJson: n.contents?.json, sender: n.sender?.address })) };
  },

  async queryTransactionBlocks({ filter, limit = 25 }: { filter: { FromAddress: string }; options?: any; order?: string; limit?: number }) {
    const { data, errors } = await gql.query<{ transactions: { nodes: Array<{ effects: { timestamp: string; balanceChanges: { nodes: Array<{ amount: string; coinType: { repr: string }; owner: { address: string } }> } } }> } }>({
      query: TXS_FROM_Q,
      variables: { addr: filter.FromAddress, last: limit },
    });
    if (errors?.length) throw new Error(errors[0].message);
    return {
      data: (data?.transactions?.nodes ?? []).reverse().map((n) => ({
        timestampMs: n.effects?.timestamp ? String(Date.parse(n.effects.timestamp)) : null,
        balanceChanges: (n.effects?.balanceChanges?.nodes ?? []).map((b) => ({
          amount: b.amount,
          coinType: b.coinType?.repr,
          owner: { AddressOwner: b.owner?.address },
        })),
      })),
    };
  },

  async waitForTransaction({ digest }: { digest: string }) {
    return grpc.waitForTransaction({ digest });
  },
};

export type ReadClient = typeof readClient;

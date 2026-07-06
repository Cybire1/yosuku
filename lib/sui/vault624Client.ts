// The Live Desk — yosuku_spike::vault624 client (predict-testnet-6-24).
//
// vault624 is the production multi-user copy-trading vault on the NEW DeepBook
// Predict deployment: ONE shared Vault624 owns ONE object-owned AccountWrapper
// (auth is generated from the vault's UID, so custody policy is exactly the
// module's API surface). Per-user DUSDC accounting lives in an on-chain ledger
// Table; a user subscribes ONE agent under hard per-trade caps (margin +
// leverage); the agent can open positions debited at the EXACT account-balance
// delta — and has NO funds-out path. `crank_settle` is permissionless and
// force-credits payouts to the position owner's ledger; `withdraw` pays
// ctx.sender() only.
//
// Proven on-chain 2026-07-03 (see suioverflow/x-relay/prove-vault624.mjs):
// exact-cost debit (1.125978), honest zero on the loss path, negatives 1/3/2/4,
// ledger ↔ account reconciled to the micro, agent Δ 0.000000.
//
// Everything here mirrors predict624Client idioms: browser-safe (no keys, no
// node imports), reads via gRPC simulation of the vault's view fns + the
// GraphQL-events-with-JSON-RPC-fallback dance from strategyClient; writes are
// wallet-signed Transaction builders.

import { Transaction } from '@mysten/sui/transactions';
import { gql, grpc, simulateReturnU64s } from './modernClients';
import { DUSDC_MULTIPLIER, CLOCK_ID } from './constants';
import { PREDICT624 } from './predict624Client';

// ─── deployment constants (published + proven 2026-07-03) ───

export const VAULT624 = {
  /** yosuku_spike package carrying the vault624 module. */
  pkg: '0x27931b561d585164fd843c4d58943281f0fcd1f9ca5db684f8fd47b5ee3791b3',
  /** The shared Vault624 (ledger + subs + positions). */
  vaultId: '0x0af6c6b0dd0628e6320832e3dfc20330da3c655f3193db6992f66b640c04bc95',
  /** The vault's object-owned AccountWrapper on the 6-24 `account` package. */
  wrapperId: '0x4714f527683cb6834b9a7c75df9144d4e554236cd1def8c1a70e2ce48f36a53d',
  /** The attested enclave agent — the signing key lives inside an AWS Nitro enclave. */
  enclaveAgent: '0xd4428ac17dcd558bf8cf82a8aa8d9ca7d83c1c2fb19a5b91c297cf85d608d30d',
  /** Framework AccumulatorRoot — required on every account-touching call. */
  accumulatorRoot: PREDICT624.accumulatorRoot,
  clock: CLOCK_ID,
} as const;

/** The DEDICATED trade-from-X vault624 instance (separate from the attested copy-desk so a
 *  user's ONE-agent subscription is never clobbered between the two products). Trade-from-X is
 *  user-directed (the tweet names the side), so it binds the PLAIN relay agent, not the enclave. */
export const VAULT624_TWEET = {
  pkg: VAULT624.pkg,
  vaultId: '0x3f99ddeda9c1388b8c85777a4931f64143fb5fc70cacc6df132d607b08bb044d',
  wrapperId: '0xc526da75acf134b160a4c442fb0bacbcd95aeff6daf2be759b65d39ec64f6f51',
  /** The bounded tweet relay agent (plain key, honors the tweeted direction — NOT the enclave). */
  tweetAgent: '0xaa50ec0fe985825bd45fcc65d301da096a487349d6993fe8f9305890284a7244',
  accumulatorRoot: PREDICT624.accumulatorRoot,
  clock: CLOCK_ID,
} as const;

/** 1e9 = 1x — the vault stores the leverage cap on the venue's own scale. */
export const LEV_1X_624 = 1_000_000_000n;

// Move abort codes in vault624 are LOAD-BEARING (the keeper matches on them too).
export const VAULT624_ERRORS: Record<number, string> = {
  0: 'no active subscription',
  1: 'not the subscribed agent',
  2: 'over your leverage cap',
  3: 'over your per-trade cap',
  4: 'balance too low',
  5: 'cost exceeded the cap',
  6: 'unknown position',
};

/** Map a raw failure string to the vault's plain-words meaning (falls back to the raw). */
export function friendlyVault624Error(raw: string): string {
  const m = raw.match(/abort(?:_|\s)?code:?\s*(\d+)/i) ?? raw.match(/MoveAbort.*?,\s*(\d+)\)/);
  if (m) {
    const msg = VAULT624_ERRORS[Number(m[1])];
    if (msg) return msg;
  }
  return raw.slice(0, 140);
}

// ─── event types (typed at the vault624 package) ───

export const EV_AGENT_TRADED = `${VAULT624.pkg}::vault624::AgentTraded`;
export const EV_SETTLED = `${VAULT624.pkg}::vault624::Settled`;
export const EV_DEPOSITED = `${VAULT624.pkg}::vault624::Deposited`;
export const EV_WITHDRAWN = `${VAULT624.pkg}::vault624::Withdrawn`;

// ─── tx builders (wallet-signed; NO sponsor — Onara only allowlists old-deployment targets) ───

/** Deposit DUSDC into the vault, credited to the SENDER's ledger entry
 *  (merge coins → split exact → vault624::deposit). */
export function buildVaultDeposit624(p: { coinIds: string[]; amountMicro: bigint }): Transaction {
  if (p.coinIds.length === 0) throw new Error('no DUSDC coins to deposit');
  const tx = new Transaction();
  const primary = tx.object(p.coinIds[0]);
  if (p.coinIds.length > 1) tx.mergeCoins(primary, p.coinIds.slice(1).map((id) => tx.object(id)));
  const [pay] = tx.splitCoins(primary, [tx.pure.u64(p.amountMicro)]);
  tx.moveCall({
    target: `${VAULT624.pkg}::vault624::deposit`,
    arguments: [
      tx.object(VAULT624.vaultId),
      tx.object(VAULT624.wrapperId),
      pay,
      tx.object(VAULT624.accumulatorRoot),
      tx.object(VAULT624.clock),
    ],
  });
  return tx;
}

/** Withdraw from the SENDER's own ledger entry — the coin is transferred to the
 *  sender unconditionally; nobody (agent included) can pull another user's funds. */
export function buildVaultWithdraw624(p: { amountMicro: bigint }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${VAULT624.pkg}::vault624::withdraw`,
    arguments: [
      tx.object(VAULT624.vaultId),
      tx.object(VAULT624.wrapperId),
      tx.pure.u64(p.amountMicro),
      tx.object(VAULT624.accumulatorRoot),
      tx.object(VAULT624.clock),
    ],
  });
  return tx;
}

/** Subscribe the sender to `agent` under hard per-trade caps. Upserts: re-subscribing
 *  replaces the terms and reactivates. maxLeverage1e9 is venue-scaled (1e9 = 1x). */
export function buildSubscribe624(p: {
  agent?: string;
  maxMarginMicro: bigint;
  maxLeverage1e9: bigint;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${VAULT624.pkg}::vault624::subscribe`,
    arguments: [
      tx.object(VAULT624.vaultId),
      tx.pure.address(p.agent ?? VAULT624.enclaveAgent),
      tx.pure.u64(p.maxMarginMicro),
      tx.pure.u64(p.maxLeverage1e9),
    ],
  });
  return tx;
}

/** ONE-signature join: deposit + subscribe composed in a single PTB — one wallet
 *  popup instead of two. Both moveCalls target the same shared vault, so they
 *  compose cleanly. amountMicro = 0 skips the deposit (already-funded users who
 *  only need to subscribe). Later top-ups / cap edits keep their own builders. */
export function buildJoinDesk624(p: {
  coinIds: string[];
  amountMicro: bigint;
  agent?: string;
  maxMarginMicro: bigint;
  maxLeverage1e9: bigint;
}): Transaction {
  const tx = new Transaction();
  if (p.amountMicro > 0n) {
    if (p.coinIds.length === 0) throw new Error('no test USDC coins to deposit');
    const primary = tx.object(p.coinIds[0]);
    if (p.coinIds.length > 1) tx.mergeCoins(primary, p.coinIds.slice(1).map((id) => tx.object(id)));
    const [pay] = tx.splitCoins(primary, [tx.pure.u64(p.amountMicro)]);
    tx.moveCall({
      target: `${VAULT624.pkg}::vault624::deposit`,
      arguments: [
        tx.object(VAULT624.vaultId),
        tx.object(VAULT624.wrapperId),
        pay,
        tx.object(VAULT624.accumulatorRoot),
        tx.object(VAULT624.clock),
      ],
    });
  }
  tx.moveCall({
    target: `${VAULT624.pkg}::vault624::subscribe`,
    arguments: [
      tx.object(VAULT624.vaultId),
      tx.pure.address(p.agent ?? VAULT624.enclaveAgent),
      tx.pure.u64(p.maxMarginMicro),
      tx.pure.u64(p.maxLeverage1e9),
    ],
  });
  return tx;
}

/** ONE-signature enable-tweet-trading: deposit + subscribe the PLAIN tweet agent on the
 *  DEDICATED trade-from-X vault624. Mirrors buildJoinDesk624 but targets VAULT624_TWEET so a
 *  user can also copy-trade the enclave desk without the two subscriptions clobbering. */
export function buildEnableTweetTrading624(p: {
  coinIds: string[];
  amountMicro: bigint;
  maxMarginMicro: bigint;
  maxLeverage1e9: bigint;
}): Transaction {
  const tx = new Transaction();
  if (p.amountMicro > 0n) {
    if (p.coinIds.length === 0) throw new Error('no test USDC coins to deposit');
    const primary = tx.object(p.coinIds[0]);
    if (p.coinIds.length > 1) tx.mergeCoins(primary, p.coinIds.slice(1).map((id) => tx.object(id)));
    const [pay] = tx.splitCoins(primary, [tx.pure.u64(p.amountMicro)]);
    tx.moveCall({
      target: `${VAULT624_TWEET.pkg}::vault624::deposit`,
      arguments: [
        tx.object(VAULT624_TWEET.vaultId),
        tx.object(VAULT624_TWEET.wrapperId),
        pay,
        tx.object(VAULT624_TWEET.accumulatorRoot),
        tx.object(VAULT624_TWEET.clock),
      ],
    });
  }
  tx.moveCall({
    target: `${VAULT624_TWEET.pkg}::vault624::subscribe`,
    arguments: [
      tx.object(VAULT624_TWEET.vaultId),
      tx.pure.address(VAULT624_TWEET.tweetAgent),
      tx.pure.u64(p.maxMarginMicro),
      tx.pure.u64(p.maxLeverage1e9),
    ],
  });
  return tx;
}

/** Deactivate the sender's subscription (terms kept for a later re-subscribe).
 *  Aborts ENoSub(0) if the sender never subscribed. */
export function buildCancel624(): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${VAULT624.pkg}::vault624::cancel`,
    arguments: [tx.object(VAULT624.vaultId)],
  });
  return tx;
}

// ─── reads (gRPC simulation of the vault's view fns — the modern devInspect) ───

/** `user`'s live ledger balance inside the vault, as a display DUSDC number
 *  (vault624::ledger_of returns 0 for users who never deposited). 0 on read failure. */
export async function fetchLedger624(user: string): Promise<number> {
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${VAULT624.pkg}::vault624::ledger_of`,
      arguments: [tx.object(VAULT624.vaultId), tx.pure.address(user)],
    });
    const [micro] = await simulateReturnU64s(tx, user);
    return Number(micro ?? 0n) / DUSDC_MULTIPLIER;
  } catch {
    return 0;
  }
}

export interface Sub624 {
  agent: string;
  maxMarginMicro: number;
  /** 1e9 = 1x. */
  maxLeverage1e9: number;
  active: boolean;
}

const decodeU64 = (bytes: Uint8Array | number[]): bigint => {
  let v = 0n;
  Array.from(bytes).forEach((b, i) => (v |= BigInt(b) << (8n * BigInt(i))));
  return v;
};

const toHexAddress = (bytes: Uint8Array | number[]): string =>
  `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;

/** `user`'s subscription — vault624::sub_of returns (agent, max_margin, max_leverage,
 *  active) and ABORTS with ENoSub(0) if the user never subscribed; the simulation
 *  failure is the "no subscription" signal, so this returns null then (and on any
 *  transient read failure — callers poll). */
export async function fetchSub624(user: string): Promise<Sub624 | null> {
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${VAULT624.pkg}::vault624::sub_of`,
      arguments: [tx.object(VAULT624.vaultId), tx.pure.address(user)],
    });
    tx.setSenderIfNotSet(user);
    const res = await grpc.simulateTransaction({ transaction: tx, include: { commandResults: true } });
    const rvs = res.commandResults?.[0]?.returnValues ?? [];
    const agentB = rvs[0]?.bcs;
    const marginB = rvs[1]?.bcs;
    const levB = rvs[2]?.bcs;
    const activeB = rvs[3]?.bcs;
    if (!agentB || agentB.length !== 32 || !marginB || !levB || !activeB) return null;
    return {
      agent: toHexAddress(agentB),
      maxMarginMicro: Number(decodeU64(marginB)),
      maxLeverage1e9: Number(decodeU64(levB)),
      active: activeB[0] === 1,
    };
  } catch {
    return null; // ENoSub abort (or transient RPC failure)
  }
}

// ─── vault activity feed (events; GraphQL → JSON-RPC fallback, strategyClient's exact dance) ───

export interface VaultEvent624 {
  kind: 'trade' | 'settle' | 'deposit' | 'withdraw';
  user: string;
  /** trade rows only. */
  agent: string | null;
  /** Packed u256 order id as a decimal string (trade + settle rows). */
  orderId: string | null;
  /** trade rows: the EXACT all-in debit measured on-chain. */
  costMicro: number;
  /** settle rows: the payout credited to the owner (0 = honest loss). */
  payoutMicro: number;
  /** trade rows: max payout (contracts). */
  qtyMicro: number;
  /** trade rows: 1e9 = 1x. */
  leverage1e9: number;
  /** trade rows: ExpiryMarket id. */
  marketId: string | null;
  /** deposit/withdraw rows. */
  amountMicro: number;
  digest: string | null;
  ts: number; // ms epoch (0 when the indexer omitted it)
}

const EVENTS_Q = `query Ev($t: String!, $last: Int!) {
  events(last: $last, filter: { type: $t }) {
    nodes { timestamp sender { address } contents { json } transaction { digest } }
  }
}`;

type EvNode = {
  timestamp: string | null;
  contents: { json: Record<string, unknown> };
  transaction: { digest: string } | null;
};

const RPC_URL = process.env.NEXT_PUBLIC_SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443';

// Testnet GraphQL event indexing lags/windows — suix_queryEvents is the reliable net.
async function jsonRpcEvents(type: string, last: number): Promise<EvNode[]> {
  try {
    const r = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'suix_queryEvents',
        params: [{ MoveEventType: type }, null, last, true],
      }),
    });
    const j = await r.json();
    type RpcEvent = { timestampMs?: string; parsedJson?: Record<string, unknown>; id?: { txDigest?: string } };
    return ((j.result?.data ?? []) as RpcEvent[]).map((e) => ({
      timestamp: e.timestampMs ? new Date(Number(e.timestampMs)).toISOString() : null,
      contents: { json: e.parsedJson ?? {} },
      transaction: e.id?.txDigest ? { digest: e.id.txDigest } : null,
    }));
  } catch {
    return [];
  }
}

async function queryEvents(type: string, last = 50): Promise<EvNode[]> {
  try {
    const { data, errors } = await gql.query<{ events: { nodes: EvNode[] } }>({
      query: EVENTS_Q,
      variables: { t: type, last },
    });
    if (!errors?.length && data?.events?.nodes?.length) return data.events.nodes.slice().reverse(); // newest first
  } catch { /* fall through to JSON-RPC */ }
  return jsonRpcEvents(type, last);
}

const num = (v: unknown): number => Number((v as string | number) ?? 0);

function baseRow(n: EvNode): Pick<VaultEvent624, 'digest' | 'ts'> {
  return {
    digest: n.transaction?.digest ?? null,
    ts: n.timestamp ? Date.parse(n.timestamp) : 0,
  };
}

/** The desk's recent on-chain activity, newest first — AgentTraded + Settled
 *  (plus Deposited/Withdrawn for the money trail), merged across the four
 *  vault624 event streams. */
export async function fetchVaultTrades624(limit = 40): Promise<VaultEvent624[]> {
  const [trades, settles, deposits, withdraws] = await Promise.all([
    queryEvents(EV_AGENT_TRADED, limit),
    queryEvents(EV_SETTLED, limit),
    queryEvents(EV_DEPOSITED, limit),
    queryEvents(EV_WITHDRAWN, limit),
  ]);
  const rows: VaultEvent624[] = [
    ...trades.map((n): VaultEvent624 => {
      const j = n.contents?.json ?? {};
      return {
        kind: 'trade',
        user: String(j.user ?? ''),
        agent: String(j.agent ?? '') || null,
        orderId: String(j.order_id ?? '') || null,
        costMicro: num(j.cost),
        payoutMicro: 0,
        qtyMicro: num(j.quantity),
        leverage1e9: num(j.leverage),
        marketId: String(j.market ?? '') || null,
        amountMicro: 0,
        ...baseRow(n),
      };
    }),
    ...settles.map((n): VaultEvent624 => {
      const j = n.contents?.json ?? {};
      return {
        kind: 'settle',
        user: String(j.user ?? ''),
        agent: null,
        orderId: String(j.order_id ?? '') || null,
        costMicro: 0,
        payoutMicro: num(j.payout),
        qtyMicro: 0,
        leverage1e9: 0,
        marketId: null,
        amountMicro: 0,
        ...baseRow(n),
      };
    }),
    ...deposits.map((n): VaultEvent624 => {
      const j = n.contents?.json ?? {};
      return {
        kind: 'deposit', user: String(j.user ?? ''), agent: null, orderId: null,
        costMicro: 0, payoutMicro: 0, qtyMicro: 0, leverage1e9: 0, marketId: null,
        amountMicro: num(j.amount), ...baseRow(n),
      };
    }),
    ...withdraws.map((n): VaultEvent624 => {
      const j = n.contents?.json ?? {};
      return {
        kind: 'withdraw', user: String(j.user ?? ''), agent: null, orderId: null,
        costMicro: 0, payoutMicro: 0, qtyMicro: 0, leverage1e9: 0, marketId: null,
        amountMicro: num(j.amount), ...baseRow(n),
      };
    }),
  ];
  return rows.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

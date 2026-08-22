// The Live Desk — yosuku_spike::vault624 client (predict-testnet-7-29).
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
// node imports), reads via gRPC simulation of the vault's view fns plus
// cursor-paginated GraphQL events; writes are
// wallet-signed Transaction builders.

import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { GRAPHQL_URL, grpc, simulateReturnU64s } from './modernClients';
import { DUSDC_MULTIPLIER, CLOCK_ID, DUSDC_TYPE } from './constants';
import { PREDICT624 } from './predict624Client';

// ─── deployment constants (published + proven 2026-07-03) ───

export const VAULT624 = {
  /** yosuku_spike package carrying the vault624 module, republished against
   *  predict-testnet-7-29 on 2026-08-06. Superseded 6-24 package: 0x27931b56…. */
  pkg: '0x51ed6dead94a7e9d799c8c245de041e8d82b0ec12d40996b7561522e3637179f',
  originPkg: '0x3ba6f82ddea29023bbd433000a0374f004e6ce2225cd98a06a1d9bfa7ccb84e1',
  /** The shared Vault624 (ledger + subs + positions) — copy-desk instance, 7-29. */
  vaultId: '0x9968dbb655c5c4ddce692f31f3f65e3c94ed22b47ab070889e2f984793f8ba1b',
  /** The vault's object-owned AccountWrapper on the 7-29 `account` package. */
  wrapperId: '0x4be93e218ad6a3171baafcc72f535394346202ac1f3625096cb6b8cc345e8c0a',
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
  // 7-29 instance. These MUST match .vault624-tweets.json on the relay box: this is the vault
  // "Fund X wallet" deposits into, and the relay only trades the one it is pointed at. If the two
  // ever drift, a user funds a balance the relay cannot see and their tweets bounce as no-deposit.
  vaultId: '0x85400f69518fb29d3f20e62afa0baff5e36b1dc34d70e660129fb9d660dd4451',
  wrapperId: '0xf1a1ca5a2abe197a662c28de028e3fb0f131b3cc67c8a6852795d25315a05536',
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
  7: 'open-position limit reached',
  8: 'total exposure limit reached',
  9: 'daily spend limit reached',
  10: 'invalid risk limits',
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

// ─── tx builders (sponsored-first via useSmartSubmit at the call sites; yosuku-vault-624 policy) ───

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
  maxTotalExposureMicro: bigint;
  maxOpenPositions: bigint;
  maxDailySpendMicro: bigint;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${VAULT624.pkg}::vault624::subscribe_with_risk`,
    arguments: [
      tx.object(VAULT624.vaultId),
      tx.pure.address(p.agent ?? VAULT624.enclaveAgent),
      tx.pure.u64(p.maxMarginMicro),
      tx.pure.u64(p.maxLeverage1e9),
      tx.pure.u64(p.maxTotalExposureMicro),
      tx.pure.u64(p.maxOpenPositions),
      tx.pure.u64(p.maxDailySpendMicro),
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
  maxTotalExposureMicro: bigint;
  maxOpenPositions: bigint;
  maxDailySpendMicro: bigint;
}): Transaction {
  const tx = new Transaction();
  if (p.amountMicro > 0n) {
    if (p.coinIds.length === 0) throw new Error('no DUSDC coins to deposit');
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
    target: `${VAULT624.pkg}::vault624::subscribe_with_risk`,
    arguments: [
      tx.object(VAULT624.vaultId),
      tx.pure.address(p.agent ?? VAULT624.enclaveAgent),
      tx.pure.u64(p.maxMarginMicro),
      tx.pure.u64(p.maxLeverage1e9),
      tx.pure.u64(p.maxTotalExposureMicro),
      tx.pure.u64(p.maxOpenPositions),
      tx.pure.u64(p.maxDailySpendMicro),
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
  /** Spend the sender's ADDRESS BALANCE instead of their coin objects.
   *
   *  A Sui address holds DUSDC in two places and only one of them is a coin object. Cashing
   *  out of the 6-24 trading account credits the address balance, so the most ordinary route
   *  into this screen — withdraw, then fund X replies — arrives with real money and zero coins
   *  to merge, and the old builder threw 'no DUSDC coins to deposit' at someone holding 154.
   *  coinWithBalance covers both pools: it spends coins when they exist and injects
   *  coin::redeem_funds when the money is in the balance. */
  fromAddressBalance?: boolean;
}): Transaction {
  const tx = new Transaction();
  if (p.amountMicro > 0n) {
    if (!p.fromAddressBalance && p.coinIds.length === 0) throw new Error('no DUSDC coins to deposit');
    let pay;
    if (p.fromAddressBalance) {
      pay = coinWithBalance({ type: DUSDC_TYPE, balance: p.amountMicro });
    } else {
      const primary = tx.object(p.coinIds[0]);
      if (p.coinIds.length > 1) tx.mergeCoins(primary, p.coinIds.slice(1).map((id) => tx.object(id)));
      [pay] = tx.splitCoins(primary, [tx.pure.u64(p.amountMicro)]);
    }
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

/** `user`'s live ledger balance (raw micro) inside the DEDICATED trade-from-X vault
 *  (VAULT624_TWEET, 0x3f99…), the one the tweet relay actually trades from. 0n on read failure.
 *  (fetchLedger624 reads the copy-desk vault 0x0af6…, a DIFFERENT object.) Use the exact micro
 *  for a full cash-out: vault624::withdraw wants the precise integer (else EBalanceTooLow). */
export async function fetchTweetLedger624Micro(user: string): Promise<bigint> {
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${VAULT624_TWEET.pkg}::vault624::ledger_of`,
      arguments: [tx.object(VAULT624_TWEET.vaultId), tx.pure.address(user)],
    });
    const [micro] = await simulateReturnU64s(tx, user);
    return micro ?? 0n;
  } catch {
    return 0n;
  }
}

/** Same trade-from-X balance as a display DUSDC number. 0 on read failure. */
export async function fetchTweetLedger624(user: string): Promise<number> {
  return Number(await fetchTweetLedger624Micro(user)) / DUSDC_MULTIPLIER;
}

/** Withdraw from the SENDER's own ledger in the trade-from-X vault (VAULT624_TWEET, 0x3f99…) —
 *  the coin is transferred to the sender unconditionally, so ONLY the user can cash out; the
 *  bounded relay agent has no withdraw path. Mirrors buildVaultWithdraw624 but on the tweet vault
 *  (0x3f99…), which the portfolio Fund X wallet flow deposits into via buildEnableTweetTrading624. */
export function buildTweetVaultWithdraw624(p: { amountMicro: bigint }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${VAULT624_TWEET.pkg}::vault624::withdraw`,
    arguments: [
      tx.object(VAULT624_TWEET.vaultId),
      tx.object(VAULT624_TWEET.wrapperId),
      tx.pure.u64(p.amountMicro),
      tx.object(VAULT624_TWEET.accumulatorRoot),
      tx.object(VAULT624_TWEET.clock),
    ],
  });
  return tx;
}

export interface Sub624 {
  agent: string;
  maxMarginMicro: number;
  /** 1e9 = 1x. */
  maxLeverage1e9: number;
  active: boolean;
}

export interface Risk624 {
  maxTotalExposureMicro: number;
  maxOpenPositions: number;
  maxDailySpendMicro: number | null;
  openExposureMicro: number;
  openPositions: number;
  spentTodayMicro: number;
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

/** Aggregate copy-risk limits and current usage, enforced by Move on every fill. */
export async function fetchRisk624(user: string): Promise<Risk624 | null> {
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${VAULT624.pkg}::vault624::risk_of`,
      arguments: [tx.object(VAULT624.vaultId), tx.pure.address(user)],
    });
    tx.setSenderIfNotSet(user);
    const res = await grpc.simulateTransaction({ transaction: tx, include: { commandResults: true } });
    const rvs = res.commandResults?.[0]?.returnValues ?? [];
    if (rvs.length < 6 || rvs.some((rv) => !rv?.bcs)) return null;
    const daily = decodeU64(rvs[2].bcs);
    return {
      maxTotalExposureMicro: Number(decodeU64(rvs[0].bcs)),
      maxOpenPositions: Number(decodeU64(rvs[1].bcs)),
      maxDailySpendMicro: daily === 18_446_744_073_709_551_615n ? null : Number(daily),
      openExposureMicro: Number(decodeU64(rvs[3].bcs)),
      openPositions: Number(decodeU64(rvs[4].bcs)),
      spentTodayMicro: Number(decodeU64(rvs[5].bcs)),
    };
  } catch {
    return null;
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

const EVENTS_Q = `query Ev($t: String!, $last: Int!, $before: String) {
  events(last: $last, before: $before, filter: { type: $t }) {
    pageInfo { hasPreviousPage startCursor }
    nodes { timestamp sender { address } contents { json } transaction { digest } }
  }
}`;

type EvNode = {
  timestamp: string | null;
  contents: { json: Record<string, unknown> };
  transaction: { digest: string } | null;
};

type EventPage = {
  events: {
    pageInfo?: { hasPreviousPage?: boolean; startCursor?: string | null };
    nodes: EvNode[];
  };
};

// Events are not exposed by Sui's core gRPC API. Walk the supported GraphQL
// connection backwards so the all-time desk record never depends on sunset JSON-RPC.
async function queryEvents(type: string, last = 50): Promise<EvNode[]> {
  const out: EvNode[] = [];
  let before: string | null = null;
  const pages = Math.min(20, Math.max(1, Math.ceil(last / 50)));
  for (let page = 0; page < pages && out.length < last; page++) {
    try {
      const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: EVENTS_Q,
          variables: { t: type, last: Math.min(50, last - out.length), before },
        }),
      });
      if (!response.ok) break;
      const body = (await response.json()) as { data?: EventPage | null; errors?: unknown[] };
      const data = body.data;
      const errors = body.errors;
      if (errors?.length || !data?.events) break;
      out.push(...(data.events.nodes ?? []).slice().reverse());
      const info: { hasPreviousPage?: boolean; startCursor?: string | null } | undefined = data.events.pageInfo;
      if (!info?.hasPreviousPage || !info.startCursor) break;
      before = info.startCursor;
    } catch {
      break;
    }
  }
  return out.slice(0, last);
}

// Desk activity, read from the TRANSACTIONS that touched this vault, not from the event index.
//
// Two problems with the event index here, and this one query fixes both. It prunes: on 2026-08-22 a
// type-filtered query for this desk's AgentTraded returned ZERO while the desk had 3 real trades, so
// the public record silently emptied itself about a week after each trade. And it is package-scoped
// with no vault field on the event, so the tweet vault's trades were being counted as this desk's.
// A transaction that touched the vault object is, by construction, this vault's.
const VAULT_TXS_Q = `query VaultTxs($o: SuiAddress!, $last: Int!, $before: String) {
  transactions(last: $last, before: $before, filter: { affectedObject: $o }) {
    pageInfo { hasPreviousPage startCursor }
    nodes {
      digest
      effects { timestamp events { nodes { contents { type { repr } json } } } }
    }
  }
}`;

type VaultTxNode = {
  digest: string;
  effects: {
    timestamp: string | null;
    events: { nodes: { contents: { type: { repr: string }; json: Record<string, unknown> } }[] } | null;
  } | null;
};

/** Every vault624 event of `name` emitted by a tx that touched THIS vault, newest last. */
async function queryVaultEventsByObject(name: string, last: number): Promise<EvNode[]> {
  const out: EvNode[] = [];
  let before: string | null = null;
  const pages = Math.min(20, Math.max(1, Math.ceil(last / 25)));
  for (let page = 0; page < pages && out.length < last; page++) {
    try {
      const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: VAULT_TXS_Q, variables: { o: VAULT624.vaultId, last: 25, before } }),
      });
      if (!response.ok) break;
      const body = (await response.json()) as {
        data?: { transactions?: { pageInfo?: { hasPreviousPage?: boolean; startCursor?: string | null }; nodes?: VaultTxNode[] } } | null;
        errors?: unknown[];
      };
      if (body.errors?.length || !body.data?.transactions) break;
      const conn = body.data.transactions;
      for (const tx of conn.nodes ?? []) {
        for (const ev of tx.effects?.events?.nodes ?? []) {
          if (!new RegExp(`::vault624::${name}$`).test(ev.contents?.type?.repr ?? '')) continue;
          out.push({
            timestamp: tx.effects?.timestamp ?? null,
            contents: { json: ev.contents?.json ?? {} },
            transaction: { digest: tx.digest },
          });
        }
      }
      const info = conn.pageInfo;
      if (!info?.hasPreviousPage || !info.startCursor) break;
      before = info.startCursor;
    } catch {
      break;
    }
  }
  return out.slice(-last);
}

async function queryVaultEventLineage(name: string, last: number): Promise<EvNode[]> {
  const packages = [...new Set([VAULT624.originPkg, VAULT624.pkg])];
  const pages = await Promise.all(
    packages.map((pkg) => queryEvents(`${pkg}::vault624::${name}`, last)),
  );
  const seen = new Set<string>();
  return pages
    .flat()
    .filter((event) => {
      const key = `${event.transaction?.digest ?? ''}:${event.timestamp ?? ''}:${JSON.stringify(event.contents?.json ?? {})}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(b.timestamp ?? '') - Date.parse(a.timestamp ?? ''))
    .slice(0, last);
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
    queryVaultEventsByObject('AgentTraded', limit),
    queryVaultEventsByObject('Settled', limit),
    queryVaultEventsByObject('Deposited', limit),
    queryVaultEventsByObject('Withdrawn', limit),
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
  // Keep only THIS desk's activity.
  //
  // vault624 events carry no vault field and the query is package-scoped, so the tweet vault
  // 0xf1a1ca5a (same package, different agent) was being merged into the copy desk's public record:
  // 5 of 8 trades and 4 of 7 settles shown were the tweet vault's, including the largest payout,
  // which dominated the sparkline. The desk advertised 4 wins / 3 losses; its real record was 1/2.
  //
  // AgentTraded carries `agent`, so trades filter exactly. Settled carries only user + order_id, so
  // it is joined back through the order ids this desk actually opened. Deposits and withdrawals
  // carry neither, so they are kept only for users this desk has traded for.
  const deskAgent = VAULT624.enclaveAgent.toLowerCase();
  const deskTrades = rows.filter((r) => r.kind === 'trade' && (r.agent ?? '').toLowerCase() === deskAgent);
  const deskOrders = new Set(deskTrades.map((r) => r.orderId).filter(Boolean));
  const deskUsers = new Set(deskTrades.map((r) => r.user.toLowerCase()).filter(Boolean));
  const mine = rows.filter((r) => {
    if (r.kind === 'trade') return (r.agent ?? '').toLowerCase() === deskAgent;
    if (r.kind === 'settle') return !!r.orderId && deskOrders.has(r.orderId);
    return deskUsers.has(r.user.toLowerCase());
  });
  return mine.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

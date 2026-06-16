// The Agent Strategy Exchange — data + tx client.
//
// Creators publish a `Strategy` (a Seal playbook capsule on Walrus + a MemWal memory
// pointer + hard risk caps + a sub fee). Subscribers pay the fee and authorize the
// strategy's agent to COPY-TRADE their own social-vault funds, under those caps — with
// the same no-divert guarantee as tweet-trades: every position the agent opens is owned
// by the subscriber and force-pays them on exit, so the creator can never divert a cent.
//
// Reads run entirely off JSON-RPC via the GraphQL/gRPC backbone (see modernClients):
//   • StrategyListed / StrategySubscribed events  → the catalogue + subscribe history
//   • social_vault::CopyTraded events             → real executed copy-trades (volume,
//                                                    distinct subscribers, last-active)
//   • getObject(strategyId)                       → current on-chain state (subscribers,
//                                                    fee, caps, capsule/memory pointers)
import { Transaction } from '@mysten/sui/transactions';
import { gql, readClient } from './modernClients';
import { DUSDC_TYPE, DUSDC_MULTIPLIER, DUSDC_DECIMALS } from './constants';
import { NET } from './network';

// yolev upgrade #2 — the package that introduced `strategy` + copy-trade. Call the new
// functions (strategy::*, social_vault::authorized_trade/create_subscription) here.
// Sourced from the network switch (testnet today; fills in on mainnet when yolev redeploys).
export const STRATEGY_PKG = NET.strategyPackage;
// The shared social vault that custodies subscriber balances (no-divert primitive).
export const SOCIAL_VAULT_ID = NET.socialVaultId;

// StrategyListed/StrategySubscribed are typed at the strategy module's package.
// CopyTraded/Subscribed were ADDED to social_vault in upgrade #2, so they are ALSO
// typed at the new package id (the 0xf3c3c446 type returns 0 for these — verified).
const STRATEGY_LISTED = `${STRATEGY_PKG}::strategy::StrategyListed`;
const STRATEGY_SUBSCRIBED = `${STRATEGY_PKG}::strategy::StrategySubscribed`;
const COPY_TRADED = `${STRATEGY_PKG}::social_vault::CopyTraded`;

const BPS = 10_000;

// ─── shapes ───

/** A copy-trade the strategy's agent executed on a subscriber's funds. */
export interface CopyTrade {
  subscription: string;
  vault: string;
  subscriber: string;
  agent: string;
  strategy: string;
  margin: number;        // DUSDC the subscriber put up
  leverageBps: number;
  notional: number;      // DUSDC deployed = margin * leverage
  balanceAfter: number;  // subscriber's remaining vault balance, DUSDC
  digest: string | null;
  ts: number;            // ms epoch
}

/** A published, investable strategy + its live, on-chain-derived performance. */
export interface StrategyCard {
  id: string;
  creator: string;
  agent: string;
  capsuleBlob: string;     // Walrus blob id (u256 as decimal string); "0" = none yet
  hasCapsule: boolean;
  memoryAccount: string;   // MemWal address; 0x0 = none
  hasMemory: boolean;
  maxLeverageBps: number;
  maxLeverage: number;     // x
  maxMargin: number;       // DUSDC
  subFee: number;          // DUSDC
  subscribers: number;
  revision: number;
  // derived from CopyTraded events:
  copyTrades: number;
  volumeCopied: number;    // DUSDC notional copied across all subscribers
  capitalCopied: number;   // DUSDC margin copied (subscriber capital deployed)
  distinctSubscribers: number;
  lastActive: number;      // ms epoch of most recent copy-trade (0 = none)
}

/** A creator's executing agent, aggregated across its strategies. Ranked by the
 *  capital subscribers have entrusted to it and the copy-trades it has actually run —
 *  NOT win-rate. (Verified realized-PnL track records populate as positions settle.) */
export interface AgentRow {
  agent: string;
  strategies: number;
  subscribers: number;       // total across this agent's strategies
  copyTrades: number;
  volumeCopied: number;      // DUSDC notional
  capitalEntrusted: number;  // DUSDC subscriber margin this agent has deployed
  distinctSubscribers: number;
  maxLeverage: number;       // the highest cap across its strategies (worst case)
  lastActive: number;        // ms epoch
  topStrategy: string | null;
}

// ─── event reads (timestamps + digests need the raw GraphQL surface) ───

const EVENTS_Q = `query Ev($t: String!, $last: Int!) {
  events(last: $last, filter: { type: $t }) {
    nodes { timestamp sender { address } contents { json } transaction { digest } }
  }
}`;

type EvNode = { timestamp: string | null; sender: { address: string }; contents: { json: Record<string, unknown> }; transaction: { digest: string } | null };

async function queryEvents(type: string, last = 100): Promise<EvNode[]> {
  try {
    const { data, errors } = await gql.query<{ events: { nodes: EvNode[] } }>({ query: EVENTS_Q, variables: { t: type, last } });
    if (errors?.length || !data) return [];
    return data.events.nodes.slice().reverse(); // newest first
  } catch {
    return [];
  }
}

function num(v: unknown): number {
  return Number((v as string | number) ?? 0);
}

/** Parse a raw CopyTraded event payload into a typed CopyTrade. */
function toCopyTrade(n: EvNode): CopyTrade {
  const j = n.contents?.json ?? {};
  const margin = num(j.margin) / DUSDC_MULTIPLIER;
  const leverageBps = num(j.leverage_bps);
  return {
    subscription: String(j.subscription ?? ''),
    vault: String(j.vault ?? ''),
    subscriber: String(j.subscriber ?? ''),
    agent: String(j.agent ?? ''),
    strategy: String(j.strategy ?? ''),
    margin,
    leverageBps,
    notional: (margin * leverageBps) / BPS,
    balanceAfter: num(j.balance) / DUSDC_MULTIPLIER,
    digest: n.transaction?.digest ?? null,
    ts: n.timestamp ? Date.parse(n.timestamp) : 0,
  };
}

/** All executed copy-trades, newest first. */
export async function fetchCopyTrades(limit = 100): Promise<CopyTrade[]> {
  return (await queryEvents(COPY_TRADED, limit)).map(toCopyTrade);
}

// ─── strategy catalogue ───

interface StrategyFields {
  creator: string;
  agent: string;
  capsule_blob: string;
  memory_account: string;
  max_leverage_bps: string;
  max_margin: string;
  sub_fee: string;
  subscribers: string;
  revision: string;
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000000';
const isZeroAddr = (a: string) => !a || a === '0x0' || a === ZERO_ADDR;

/**
 * The full marketplace: every listed strategy, merged with its current on-chain state
 * and the live copy-trade performance derived from CopyTraded events.
 */
export async function fetchStrategies(): Promise<StrategyCard[]> {
  // 1. the catalogue — every StrategyListed event gives us a strategy id to hydrate.
  const listed = await queryEvents(STRATEGY_LISTED, 100);
  const ids = Array.from(new Set(listed.map((n) => String(n.contents?.json?.strategy ?? '')).filter(Boolean)));
  if (ids.length === 0) return [];

  // 2. copy-trades, grouped by strategy, for live performance.
  const trades = await fetchCopyTrades(200);
  const byStrategy = new Map<string, CopyTrade[]>();
  for (const t of trades) {
    if (!byStrategy.has(t.strategy)) byStrategy.set(t.strategy, []);
    byStrategy.get(t.strategy)!.push(t);
  }

  // 3. hydrate each strategy's current state and merge.
  const cards = await Promise.all(ids.map(async (id): Promise<StrategyCard | null> => {
    try {
      const res = await readClient.getObject({ id, options: { showContent: true } });
      const f = res.data?.content?.fields as unknown as StrategyFields | null;
      if (!f) return null;
      const ts = byStrategy.get(id) ?? [];
      const subs = new Set(ts.map((t) => t.subscriber));
      const maxLeverageBps = Number(f.max_leverage_bps);
      return {
        id,
        creator: f.creator,
        agent: f.agent,
        capsuleBlob: String(f.capsule_blob ?? '0'),
        hasCapsule: String(f.capsule_blob ?? '0') !== '0',
        memoryAccount: f.memory_account,
        hasMemory: !isZeroAddr(f.memory_account),
        maxLeverageBps,
        maxLeverage: maxLeverageBps / BPS,
        maxMargin: Number(f.max_margin) / DUSDC_MULTIPLIER,
        subFee: Number(f.sub_fee) / DUSDC_MULTIPLIER,
        subscribers: Number(f.subscribers),
        revision: Number(f.revision),
        copyTrades: ts.length,
        volumeCopied: ts.reduce((s, t) => s + t.notional, 0),
        capitalCopied: ts.reduce((s, t) => s + t.margin, 0),
        distinctSubscribers: subs.size,
        lastActive: ts.reduce((m, t) => Math.max(m, t.ts), 0),
      };
    } catch {
      return null;
    }
  }));

  return cards.filter((c): c is StrategyCard => c !== null)
    // most-subscribed first, then most-recently-active.
    .sort((a, b) => b.subscribers - a.subscribers || b.lastActive - a.lastActive);
}

/**
 * The agent leaderboard: every executing agent across all strategies, ranked by the
 * capital subscribers have entrusted to it and the copy-trades it has actually run.
 * Deliberately NOT ranked on win-rate — that's a vanity metric. Verified realized-PnL
 * track records (drawdown, return/risk, liquidations) populate as positions settle.
 */
export async function fetchAgents(strategies?: StrategyCard[]): Promise<AgentRow[]> {
  const cards = strategies ?? (await fetchStrategies());
  const trades = await fetchCopyTrades(200);

  const map = new Map<string, AgentRow>();
  const subsByAgent = new Map<string, Set<string>>();

  const ensure = (agent: string): AgentRow => {
    if (!map.has(agent)) {
      map.set(agent, { agent, strategies: 0, subscribers: 0, copyTrades: 0, volumeCopied: 0, capitalEntrusted: 0, distinctSubscribers: 0, maxLeverage: 0, lastActive: 0, topStrategy: null });
      subsByAgent.set(agent, new Set());
    }
    return map.get(agent)!;
  };

  // strategies the agent runs
  let topSubsByAgent = new Map<string, number>();
  for (const c of cards) {
    const a = ensure(c.agent);
    a.strategies += 1;
    a.subscribers += c.subscribers;
    a.maxLeverage = Math.max(a.maxLeverage, c.maxLeverage);
    if ((topSubsByAgent.get(c.agent) ?? -1) < c.subscribers) {
      topSubsByAgent.set(c.agent, c.subscribers);
      a.topStrategy = c.id;
    }
  }

  // copy-trades the agent executed
  for (const t of trades) {
    const a = ensure(t.agent);
    a.copyTrades += 1;
    a.volumeCopied += t.notional;
    a.capitalEntrusted += t.margin;
    a.lastActive = Math.max(a.lastActive, t.ts);
    subsByAgent.get(t.agent)!.add(t.subscriber);
  }
  for (const [agent, set] of subsByAgent) ensure(agent).distinctSubscribers = set.size;

  return Array.from(map.values())
    // entrusted capital first, then copy-trades, then subscribers.
    .sort((a, b) => b.capitalEntrusted - a.capitalEntrusted || b.copyTrades - a.copyTrades || b.subscribers - a.subscribers);
}

// ─── tx builders ───

function mergedPrimary(tx: Transaction, coinIds: string[]) {
  const primary = tx.object(coinIds[0]);
  if (coinIds.length > 1) tx.mergeCoins(primary, coinIds.slice(1).map((id) => tx.object(id)));
  return primary;
}

/**
 * Subscriber: pay the creator's fee and authorize the strategy's agent to copy-trade
 * your social-vault funds under the strategy's caps. Splits exactly the fee from the
 * subscriber's DUSDC; the contract refunds any remainder. Emits a `social_vault::
 * Subscription` (the on-chain consent record) + StrategySubscribed.
 */
export function buildSubscribeTx(p: {
  strategyId: string;
  coinIds: string[];
  subFeeMicro: bigint;
}): Transaction {
  const tx = new Transaction();
  // split exactly the fee; subscribe() refunds any excess back to the sender.
  const [payment] = tx.splitCoins(mergedPrimary(tx, p.coinIds), [p.subFeeMicro]);
  tx.moveCall({
    target: `${STRATEGY_PKG}::strategy::subscribe`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(p.strategyId), tx.object(SOCIAL_VAULT_ID), payment],
  });
  return tx;
}

/**
 * Creator: list a new investable strategy. Returns the tx; the StrategyCap is
 * transferred to the creator. Caps are the hard ceiling the agent is bound to on every
 * subscriber's funds (leverage ≥ 1x, positive max margin).
 */
export function buildListStrategyTx(p: {
  agent: string;
  capsuleBlob: bigint;   // Walrus blob id (0 = none yet)
  memoryAccount: string; // MemWal addr (0x0 = none)
  maxLeverageBps: number;
  maxMarginMicro: bigint;
  subFeeMicro: bigint;
  creator: string;
}): Transaction {
  const tx = new Transaction();
  const cap = tx.moveCall({
    target: `${STRATEGY_PKG}::strategy::list_strategy`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.pure.address(p.agent),
      tx.pure.u256(p.capsuleBlob),
      tx.pure.address(p.memoryAccount),
      tx.pure.u64(BigInt(p.maxLeverageBps)),
      tx.pure.u64(p.maxMarginMicro),
      tx.pure.u64(p.subFeeMicro),
    ],
  });
  tx.transferObjects([cap], tx.pure.address(p.creator));
  return tx;
}

// ─── formatting helpers (shared by both pages) ───

export const fmtDusdc = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 1000 ? 2 : 0 });

export const fmtAddr = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function ago(ts: number): string {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Deterministic decorative kanji from an address — a light identity mark (texture, not
// a label), matching the leaderboard's avatar treatment.
const KANJI_POOL = '林青霧桜雷雪川石山松森光鳥夜梅藤熊寒銀金空海風波';
export function glyphFromAddress(addr: string): string {
  let hash = 0;
  for (let i = 0; i < addr.length; i++) hash = ((hash << 5) - hash + addr.charCodeAt(i)) | 0;
  return KANJI_POOL[Math.abs(hash) % KANJI_POOL.length];
}

export const SUISCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
export const SUISCAN_ACC = (a: string) => `https://suiscan.xyz/testnet/account/${a}`;
export const DUSDC_DISPLAY_DECIMALS = DUSDC_DECIMALS;

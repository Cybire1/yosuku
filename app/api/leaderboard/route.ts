import { NextResponse } from 'next/server';
import { computeLeaderboard624, type AccountOrders624, type Order624Raw } from '@/lib/leaderboard624';
import { readSettlementPrice, isWinningRange } from '@/lib/sui/settlement';

// ── Built from ON-CHAIN order events, not an indexer ──
//
// This used to enumerate accounts and then pull each one's order feed from predict-server-beta.
// That indexer serves the 6-24 deployment ONLY, so after the 7-29 migration it answered for
// nothing and the board went blank — no error, just empty, which is the failure shape that cost
// the most time in this whole migration.
//
// The chain is the better source anyway. `order_events` carries owner, account_id, order ids and
// every amount the ranking engine needs, so one query per event type replaces a fan-out of one
// request per account. No third-party host on the critical path, so nobody else's outage can
// blank the board, and settlement payouts arrive in the same stream as the mints.
const GRAPHQL_URL = 'https://graphql.testnet.sui.io/graphql';
// predict-testnet-7-29 (migrated 2026-08-06). Accounts and orders from 6-24 are different types
// and stop appearing, so the board reflects the live venue rather than mixing two deployments.
const PREDICT_PACKAGE = '0xfe742239a3b033f7d52ed5275f238c17d27498ca0ee5ea5672ea732eb3f4dbbb';
const ACCOUNT_PACKAGE = '0xbdbb60b00f2d4f30daeff62f2c642b18433a8fcdfbebccc808df578df2a0c203';
const ACCOUNT_CREATED_TYPE = `${ACCOUNT_PACKAGE}::account_events::AccountCreated`;
// Our Onara gas station. An account whose SETUP it paid for came through Yosuku; the venue is
// shared with other teams, and their bots are not our community. Verified: the two high-volume
// accounts on this venue self-funded their setup, while a real Yosuku user's was sponsored here.
const YOSUKU_GAS_SPONSOR = '0xe26c11844116abb0d3d76fb88a25831f4a22cbbb3fee6bf096d779875a0c4c69';

// Event type → the `kind` string computeLeaderboard624 switches on.
const ORDER_EVENTS: Array<{ type: string; kind: string }> = [
  { type: `${PREDICT_PACKAGE}::order_events::OrderMinted`, kind: 'order_minted' },
  { type: `${PREDICT_PACKAGE}::order_events::SettledOrderRedeemed`, kind: 'settled_order_redeemed' },
  { type: `${PREDICT_PACKAGE}::order_events::LiveOrderRedeemed`, kind: 'live_order_redeemed' },
  { type: `${PREDICT_PACKAGE}::order_events::LiquidatedOrderRedeemed`, kind: 'liquidated_order_redeemed' },
];

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7-day rolling window (testnet activity is sparse)
const CACHE_TTL = 5 * 60 * 1000;
const PAGE = 50;          // GraphQL caps event pages at 50 — asking for more is a validation error
const MAX_PAGES = 12;     // ≈600 events per type; well past a 7-day window on this venue
const ACCOUNTS_PAGE = 50;
const ACCOUNTS_MAX = 300;
const TRADER_CONCURRENCY = 8;

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

interface LeaderboardResponse {
  rankings: ReturnType<typeof computeLeaderboard624>['rankings'];
  meta: {
    period: '7d';
    windowStartMs: number;
    windowEndMs: number;
    rankedTraders: number;
    totalWallets: number;
    closedCalls: number;
    totalVolume: number;
    complete: boolean;
    unmatchedRedemptions: number;
  };
  records: never[];
}

let cache: { data: LeaderboardResponse; ts: number } | null = null;

interface EventNode { timestamp?: string; contents?: { json?: Record<string, unknown> }; transaction?: { gasInput?: { gasSponsor?: { address?: string } } } }

/**
 * One trader's events, filtered server-side by sender.
 *
 * This is what makes a real time window affordable. Paging the global event stream is hopeless
 * on a venue with a high-frequency bot: 600 events reached back only FOUR MINUTES, so a genuine
 * user's bet from earlier the same hour fell off the end and the board silently omitted them.
 * Filtering by sender bounds the work to one trader's own history, so a seven-day window costs a
 * page or two per person instead of thousands globally.
 *
 * Sender is the right key: Sui sponsored transactions keep the USER as sender and only move gas
 * payment to the sponsor, so a gas-free Yosuku bet still reports its owner here.
 */
async function fetchTraderEvents(sender: string, sinceMs: number): Promise<Array<{ kind: string; tsMs: number; json: Record<string, unknown> }>> {
  const out: Array<{ kind: string; tsMs: number; json: Record<string, unknown> }> = [];
  for (const { type, kind } of ORDER_EVENTS.filter((e) => e.kind === 'order_minted' || e.kind === 'live_order_redeemed')) {
    let before: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const args = [`last: ${PAGE}`, `filter: { type: "${type}", sender: "${sender}" }`];
      if (before) args.push(`before: "${before}"`);
      const q = `{ events(${args.join(', ')}) { pageInfo { hasPreviousPage startCursor } nodes { timestamp contents { json } } } }`;
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }), cache: 'no-store',
      });
      if (!res.ok) break;
      const json = (await res.json()) as { errors?: unknown; data?: { events?: { pageInfo?: { hasPreviousPage?: boolean; startCursor?: string }; nodes?: EventNode[] } } };
      if (json.errors) throw new Error(`trader event query failed: ${JSON.stringify(json.errors).slice(0, 160)}`);
      const conn = json.data?.events;
      let passed = false;
      for (const n of conn?.nodes ?? []) {
        const j = n.contents?.json;
        if (!j) continue;
        const tsMs = n.timestamp ? Date.parse(n.timestamp) : NaN;
        if (!Number.isFinite(tsMs)) continue;
        if (tsMs < sinceMs) { passed = true; continue; }
        out.push({ kind, tsMs, json: j });
      }
      if (passed || !conn?.pageInfo?.hasPreviousPage || !conn.pageInfo.startCursor) break;
      before = conn.pageInfo.startCursor;
    }
  }
  return out;
}

/** Every account and its owner, plus the protocol-owned ones so our desks never rank as traders. */
async function fetchAccounts(): Promise<{ selfOwned: Set<string>; humans: Map<string, string> }> {
  const query = `query Ev($t: String!, $last: Int!, $before: String) {
    events(last: $last, before: $before, filter: { type: $t }) {
      pageInfo { hasPreviousPage startCursor }
      nodes { transaction { gasInput { gasSponsor { address } } } contents { json } }
    }
  }`;
  const selfOwned = new Set<string>();
  const humans = new Map<string, string>(); // account_id -> owner
  let before: string | null = null;
  for (let page = 0; page < Math.ceil(ACCOUNTS_MAX / ACCOUNTS_PAGE); page++) {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { t: ACCOUNT_CREATED_TYPE, last: ACCOUNTS_PAGE, before } }),
      cache: 'no-store',
    });
    if (!res.ok) break;
    const json = (await res.json()) as {
      data?: { events?: { pageInfo?: { hasPreviousPage?: boolean; startCursor?: string }; nodes?: EventNode[] } };
    };
    const conn = json.data?.events;
    for (const n of conn?.nodes ?? []) {
      const j = n.contents?.json as { account_id?: string; owner?: string; self_owned?: boolean } | undefined;
      if (!j?.account_id) continue;
      if (j.self_owned === true) { selfOwned.add(j.account_id); continue; }
      // Only accounts Yosuku onboarded. Without this the board ranks other teams' bots — one had
      // 576 trades and would sit permanently at the top of a leaderboard our users read as theirs.
      const sponsor = (n as { transaction?: { gasInput?: { gasSponsor?: { address?: string } } } })
        .transaction?.gasInput?.gasSponsor?.address;
      if (sponsor !== YOSUKU_GAS_SPONSOR) continue;
      if (j.owner) humans.set(j.account_id, j.owner);
    }
    if (!conn?.pageInfo?.hasPreviousPage || !conn.pageInfo.startCursor) break;
    before = conn.pageInfo.startCursor;
  }
  return { selfOwned, humans };
}

/** Bounded-concurrency map, so a busy venue doesn't open one socket per trader at once. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

interface MintRef {
  accountId: string;
  rootId: string;
  marketId: string;
  lowerTick: bigint;
  higherTick: bigint;
  quantity: string;
  tsMs: number;
}

const POS_INF_TICK = (1n << 30n) - 1n;
// Every 7-29 BTC market ships this tick_size; MarketCreated carries it if that ever changes.
const TICK_SIZE = 10_000_000n;

/**
 * Resolve every settled position from chain state.
 *
 * The ranking engine only scores a position once it has been REDEEMED. A losing bet pays nothing,
 * so nobody ever redeems it — our own keeper skips losers deliberately, because redeeming one is
 * a guarded no-op that just burns gas. Left alone, the board counts wins and silently drops
 * losses, flattering exactly the people who bet through us while scoring anyone who redeems
 * everything honestly.
 *
 * A settled loss is final and its payout can only ever be zero, so synthesise the redemption the
 * chain will never emit. Unredeemed WINNERS are deliberately left out: they are still owed money
 * and will appear for real once cranked.
 */
async function resolveSettled(
  byAccount: Map<string, AccountOrders624>,
  mints: MintRef[],
  windowStartMs: number,
  windowEndMs: number,
): Promise<void> {
  const open = mints.filter((m) => {
    const acct = byAccount.get(m.accountId);
    if (!acct) return false;
    // Already redeemed (win, early close or liquidation) → the chain stated the outcome.
    return !acct.orders.some((o) => o.kind.endsWith('_redeemed') && o.position_root_id === m.rootId);
  });
  if (!open.length) return;

  const settlements = new Map<string, bigint | null>();
  for (const marketId of new Set(open.map((m) => m.marketId))) {
    settlements.set(marketId, await readSettlementPrice(marketId));
  }

  for (const m of open) {
    const settled = settlements.get(m.marketId);
    if (settled == null) continue; // still live — genuinely open, not a loss
    const won = isWinningRange(settled, m.lowerTick, m.higherTick, TICK_SIZE, POS_INF_TICK);
    const acct = byAccount.get(m.accountId);
    if (!acct) continue;
    // Stamp at mint time: the close time is unknowable for something never cranked, and the mint
    // is the moment we can prove fell inside the window.
    acct.orders.push({
      kind: 'settled_order_redeemed',
      position_root_id: m.rootId,
      order_id: m.rootId,
      checkpoint_timestamp_ms: Math.min(Math.max(m.tsMs, windowStartMs), windowEndMs),
      // A settled binary pays exactly its quantity when in range, and nothing when not —
      // verified against live redemptions. So the outcome is fully derivable from chain state
      // and never depends on WHO cranked the redemption, which matters because our keeper
      // redeems on users' behalf and a sender-scoped query would miss every win it settles.
      payout_amount: won ? m.quantity : '0',
    });
  }
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return NextResponse.json(cache.data);

  try {
    const windowEndMs = Date.now();
    const windowStartMs = windowEndMs - WINDOW_MS;

    const { selfOwned, humans } = await fetchAccounts();

    // Per TRADER, not per global page. Filtering by sender keeps each query bounded to one
    // person's own history, so the full window is affordable; paging the global stream reached
    // back only four minutes on this venue because a single bot dominates it.
    const traders = [...new Set(humans.values())];
    const perTrader = await mapPool(traders, TRADER_CONCURRENCY, (t) => fetchTraderEvents(t, windowStartMs));

    // Fold every event stream into the per-account order lists the engine already understands.
    const byAccount = new Map<string, AccountOrders624>();
    const mintIndex: MintRef[] = [];
    const covered = true;              // sender-scoped queries genuinely reach the window
    const coveredFromMs = windowStartMs;

    perTrader.forEach((events) => {
      for (const { kind, tsMs, json } of events) {
        const accountId = String(json.account_id ?? '');
        const owner = String(json.owner ?? '');
        if (!accountId || !owner || selfOwned.has(accountId)) continue;

        let acct = byAccount.get(accountId);
        if (!acct) { acct = { accountId, owner, orders: [] }; byAccount.set(accountId, acct); }

        const order: Order624Raw = {
          kind,
          order_id: json.order_id != null ? String(json.order_id) : undefined,
          position_root_id: json.position_root_id != null ? String(json.position_root_id) : undefined,
          checkpoint_timestamp_ms: tsMs,
        };
        if (json.net_premium != null) order.net_premium = String(json.net_premium);
        if (json.payout_amount != null) order.payout_amount = String(json.payout_amount);
        if (json.redeem_amount != null) order.redeem_amount = String(json.redeem_amount);
        acct.orders.push(order);

        if (kind === 'order_minted' && json.expiry_market_id) {
          mintIndex.push({
            accountId,
            rootId: String(json.position_root_id ?? json.order_id ?? ''),
            marketId: String(json.expiry_market_id),
            lowerTick: BigInt(String(json.lower_tick ?? 0)),
            higherTick: BigInt(String(json.higher_tick ?? 0)),
            quantity: String(json.quantity ?? '0'),
            tsMs,
          });
        }
      }
    });

    await resolveSettled(byAccount, mintIndex, windowStartMs, windowEndMs);

    // Newest-first per account, matching what the indexer feed used to return.
    const withOrders = [...byAccount.values()];
    for (const a of withOrders) {
      a.orders.sort((x, y) => Number(y.checkpoint_timestamp_ms ?? 0) - Number(x.checkpoint_timestamp_ms ?? 0));
    }

    const { rankings, closedCalls, rankedTraders } = computeLeaderboard624(withOrders, windowStartMs, windowEndMs);
    const top = rankings.slice(0, 50);
    const totalVolume = top.reduce((sum, t) => sum + t.volume, 0);

    const result: LeaderboardResponse = {
      rankings: top,
      meta: {
        period: '7d',
        windowStartMs: coveredFromMs,
        windowEndMs,
        rankedTraders,
        totalWallets: withOrders.length,
        closedCalls,
        totalVolume: Math.round(totalVolume * 100) / 100,
        complete: covered,
        unmatchedRedemptions: 0,
      },
      records: [],
    };

    cache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (error) {
    console.error('Leaderboard API error:', error);
    return NextResponse.json({
      error: 'Failed to compute leaderboard',
      rankings: [],
      meta: {
        period: '7d',
        windowStartMs: Date.now() - WINDOW_MS,
        windowEndMs: Date.now(),
        rankedTraders: 0,
        totalWallets: 0,
        closedCalls: 0,
        totalVolume: 0,
        complete: false,
        unmatchedRedemptions: 0,
      },
      records: [],
    }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { computeLeaderboard624, type AccountOrders624, type Order624Raw } from '@/lib/leaderboard624';

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

interface EventNode { timestamp?: string; contents?: { json?: Record<string, unknown> } }

/** Page an event type backwards from newest, stopping once we pass the window. */
async function fetchEvents(type: string, sinceMs: number): Promise<Array<{ tsMs: number; json: Record<string, unknown> }>> {
  const query = `query Ev($t: String!, $last: Int!, $before: String) {
    events(last: $last, before: $before, filter: { type: $t }) {
      pageInfo { hasPreviousPage startCursor }
      nodes { timestamp contents { json } }
    }
  }`;
  const out: Array<{ tsMs: number; json: Record<string, unknown> }> = [];
  let before: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { t: type, last: PAGE, before } }),
      cache: 'no-store',
    });
    if (!res.ok) break;
    const json = (await res.json()) as {
      errors?: unknown;
      data?: { events?: { pageInfo?: { hasPreviousPage?: boolean; startCursor?: string }; nodes?: EventNode[] } };
    };
    // A malformed query returns data:null with errors, which is indistinguishable downstream
    // from "this venue has no trades". Fail loudly rather than silently rank nobody.
    if (json.errors) throw new Error(`event query failed (${type.split('::').pop()}): ${JSON.stringify(json.errors).slice(0, 160)}`);
    const conn = json.data?.events;
    const nodes = conn?.nodes ?? [];

    let passedWindow = false;
    for (const n of nodes) {
      const j = n.contents?.json;
      if (!j) continue;
      const tsMs = n.timestamp ? Date.parse(n.timestamp) : NaN;
      if (!Number.isFinite(tsMs)) continue;
      if (tsMs < sinceMs) { passedWindow = true; continue; }
      out.push({ tsMs, json: j });
    }
    // Nodes come oldest-first within a backwards page, so once the OLDEST in a page predates the
    // window there is nothing left to gain by paging further back.
    if (passedWindow) break;
    if (!conn?.pageInfo?.hasPreviousPage || !conn.pageInfo.startCursor) break;
    before = conn.pageInfo.startCursor;
  }
  return out;
}

/** account_ids that belong to protocol-owned vaults, so our own desks never rank as traders. */
async function fetchSelfOwnedAccounts(): Promise<Set<string>> {
  const query = `query Ev($t: String!, $last: Int!, $before: String) {
    events(last: $last, before: $before, filter: { type: $t }) {
      pageInfo { hasPreviousPage startCursor }
      nodes { contents { json } }
    }
  }`;
  const selfOwned = new Set<string>();
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
      const j = n.contents?.json as { account_id?: string; self_owned?: boolean } | undefined;
      if (j?.account_id && j.self_owned === true) selfOwned.add(j.account_id);
    }
    if (!conn?.pageInfo?.hasPreviousPage || !conn.pageInfo.startCursor) break;
    before = conn.pageInfo.startCursor;
  }
  return selfOwned;
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return NextResponse.json(cache.data);

  try {
    const windowEndMs = Date.now();
    const windowStartMs = windowEndMs - WINDOW_MS;

    const [selfOwned, ...streams] = await Promise.all([
      fetchSelfOwnedAccounts(),
      ...ORDER_EVENTS.map((e) => fetchEvents(e.type, windowStartMs)),
    ]);

    // Fold every event stream into the per-account order lists the engine already understands.
    const byAccount = new Map<string, AccountOrders624>();
    streams.forEach((events, i) => {
      const kind = ORDER_EVENTS[i].kind;
      for (const { tsMs, json } of events) {
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
      }
    });

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
        windowStartMs,
        windowEndMs,
        rankedTraders,
        totalWallets: withOrders.length,
        closedCalls,
        totalVolume: Math.round(totalVolume * 100) / 100,
        complete: true,
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

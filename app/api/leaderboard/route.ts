import { NextResponse } from 'next/server';
import { computeLeaderboard624, type AccountOrders624, type Order624Raw } from '@/lib/leaderboard624';

// ── Live 6-24 venue (predict-server-beta), NOT the dead 4-16 predict-server ──
// The old leaderboard queried predict-server.testnet (the 4-16 venue) via a global
// /positions/redeemed feed — that venue went quiet when everything migrated to 6-24,
// so the board was always empty. The 6-24 venue is account-scoped with no global
// trade feed, so we enumerate accounts from AccountCreated events and pull each
// account's order feed. Constants mirror lib/sui/predict624Client.ts PREDICT624.
const BETA_INDEXER = 'https://predict-server-beta.testnet.mystenlabs.com';
const GRAPHQL_URL = 'https://graphql.testnet.sui.io/graphql';
const ACCOUNT_PACKAGE = '0xb9389eac8d59170ffd1427c1a66e5c8306263464fcc6615e825c1f5b3e15da3b';
const ACCOUNT_CREATED_TYPE = `${ACCOUNT_PACKAGE}::account_events::AccountCreated`;

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7-day rolling window (testnet activity is sparse)
const CACHE_TTL = 5 * 60 * 1000;
const ACCOUNTS_MAX = 300;      // scan the most recent N accounts (young venue → covers the field)
const ACCOUNTS_PAGE = 50;      // GraphQL caps event pages at 50
const ORDERS_LIMIT = 250;      // per-account order rows (newest first)
const FETCH_CONCURRENCY = 10;

export const maxDuration = 60;

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

interface AccountCreated {
  account_id?: string;
  owner?: string;
  self_owned?: boolean;
}

/** Enumerate the most recent human-owned 6-24 accounts (newest-first, paginated). */
async function fetchAccounts(): Promise<{ accountId: string; owner: string }[]> {
  const query = `query Ev($t: String!, $last: Int!, $before: String) {
    events(last: $last, before: $before, filter: { type: $t }) {
      pageInfo { hasPreviousPage startCursor }
      nodes { contents { json } }
    }
  }`;
  const seen = new Map<string, string>(); // account_id → owner
  let before: string | null = null;

  for (let page = 0; page < Math.ceil(ACCOUNTS_MAX / ACCOUNTS_PAGE); page++) {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { t: ACCOUNT_CREATED_TYPE, last: ACCOUNTS_PAGE, before } }),
      next: { revalidate: 120 },
    });
    if (!res.ok) break;
    const json = (await res.json()) as {
      data?: { events?: { pageInfo?: { hasPreviousPage?: boolean; startCursor?: string }; nodes?: { contents?: { json?: AccountCreated } }[] } };
    };
    const conn = json.data?.events;
    for (const node of conn?.nodes ?? []) {
      const j = node.contents?.json;
      if (!j?.account_id || !j.owner || j.self_owned === true) continue;
      if (!seen.has(j.account_id)) seen.set(j.account_id, j.owner);
    }
    if (!conn?.pageInfo?.hasPreviousPage || !conn.pageInfo.startCursor) break;
    before = conn.pageInfo.startCursor;
  }

  return [...seen.entries()].map(([accountId, owner]) => ({ accountId, owner }));
}

/** Bounded-concurrency map. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function fetchOrders(accountId: string): Promise<{ orders: Order624Raw[]; failed: boolean }> {
  try {
    const res = await fetch(`${BETA_INDEXER}/accounts/${accountId}/orders?limit=${ORDERS_LIMIT}`, {
      headers: { accept: 'application/json' },
      next: { revalidate: 120 },
    });
    if (!res.ok) return { orders: [], failed: true };
    const rows = (await res.json()) as Order624Raw[];
    return { orders: Array.isArray(rows) ? rows : [], failed: false };
  } catch {
    return { orders: [], failed: true };
  }
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return NextResponse.json(cache.data);

  try {
    const windowEndMs = Date.now();
    const windowStartMs = windowEndMs - WINDOW_MS;

    const accounts = await fetchAccounts();
    const histories = await mapPool(accounts, FETCH_CONCURRENCY, (a) => fetchOrders(a.accountId));

    const withOrders: AccountOrders624[] = accounts.map((a, idx) => ({
      accountId: a.accountId,
      owner: a.owner,
      orders: histories[idx].orders,
    }));
    const failed = histories.filter((h) => h.failed).length;

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
        totalWallets: accounts.length,
        closedCalls,
        totalVolume: Math.round(totalVolume * 100) / 100,
        complete: failed === 0,
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

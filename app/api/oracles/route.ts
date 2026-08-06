// Markets + spot for the web app.
//
// Keep this route byte-compatible with the old oracle response:
// `{ oracles: [...], prices: { [marketId]: { spot } } }`.
//
// NEVER let this response be cached. Every row carries a `status` of active-or-settled that is
// computed from Date.now() at render time, so a cached copy does not go stale gracefully — it
// actively lies, labelling rounds that closed twenty minutes ago as live and inviting a bet on
// them. Observed exactly that in production: `x-vercel-cache: HIT` serving 8 "active" markets of
// which only 2 were still in the future. The in-process caches below (15s markets / 5s price) are
// the right place to absorb load; the CDN is not.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const NO_STORE = { 'cache-control': 'no-store, max-age=0, must-revalidate' } as const;

// predict-testnet-7-29 (migrated 2026-08-06). Neither the beta indexer nor propbook serves this
// deployment, so markets come from MarketCreated events and spot comes off the PythFeed object.
const GRAPHQL_URL = 'https://graphql.testnet.sui.io/graphql';
const GRPC_URL = 'https://fullnode.testnet.sui.io:443';
const PREDICT_PKG = '0xfe742239a3b033f7d52ed5275f238c17d27498ca0ee5ea5672ea732eb3f4dbbb';
const MARKET_CREATED_TYPE = `${PREDICT_PKG}::config_events::MarketCreated`;
const PYTH_FEED = '0xccafaa6c5a41f0493585cf268f2b4dc14c91ed798362444144cac2c745db8dde';

const MARKET_CACHE_TTL = 15_000;
const PRICE_CACHE_TTL = 5_000;
const TIMEOUT_MS = 12_000;

interface OracleEntry {
  oracle_id: string;
  status: string;
  settled_at: number | null;
  expiry: number;
  min_strike: string;
  tick_size: string;
  underlying_asset: string;
  max_admission_leverage?: string;
  // Added for the browser market list, which used to read the 6-24 indexer directly and needs
  // these two to snap mint ticks and show the real trading window.
  admission_tick_size?: string;
  created_ms?: number;
}

interface Cached<T> { data: T; ts: number }
let marketCache: Cached<OracleEntry[]> | null = null;
let priceCache: Cached<number | null> | null = null;
let marketInFlight: Promise<OracleEntry[]> | null = null;

/** MarketCreated straight off the chain. There is NO 7-29 indexer: predict-server-beta returns
 *  6-24 rows only, so the old fetch would have quietly filled /markets with untradeable rounds.
 *  The event carries every field this route used. GraphQL caps a page at 50, so page backwards. */
async function fetchMarketRowsOnChain(): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let before: string | null = null;
  for (let i = 0; i < 4; i++) {
    const args = [`last: 50`, `filter: { type: "${MARKET_CREATED_TYPE}" }`];
    if (before) args.push(`before: "${before}"`);
    // `timestamp` is the creation time, which the browser needs to show a market's real trading
    // window (expiry − created). The old 6-24 indexer row carried it as checkpoint_timestamp_ms.
    const q = `{ events(${args.join(', ')}) { pageInfo { hasPreviousPage startCursor } nodes { timestamp contents { json } } } }`;
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    // Surface a broken query instead of returning [] — "no markets" and "bad filter" look
    // identical downstream, and one of them silently empties the markets page.
    if (!body || body.errors) throw new Error(`market discovery failed: ${JSON.stringify(body?.errors ?? 'unparseable').slice(0, 160)}`);
    const ev = body.data?.events;
    for (const n of ev?.nodes ?? []) {
      if (!n?.contents?.json) continue;
      const created = n.timestamp ? Date.parse(n.timestamp) : NaN;
      rows.push({ ...n.contents.json, created_ms: Number.isFinite(created) ? created : undefined });
    }
    if (!ev?.pageInfo?.hasPreviousPage || !ev?.pageInfo?.startCursor) break;
    before = ev.pageInfo.startCursor;
  }
  return rows;
}

async function fetchMarkets(): Promise<OracleEntry[]> {
  const rows = await fetchMarketRowsOnChain();
  const now = Date.now();
  const seen = new Set<string>();
  const out: OracleEntry[] = [];

  for (const market of Array.isArray(rows) ? rows : []) {
    const id = String(market.expiry_market_id ?? '');
    const expiry = Number(market.expiry);
    if (!id || !Number.isFinite(expiry) || seen.has(id)) continue;
    seen.add(id);

    // Keep recently-settled rounds around briefly so just-closed cards can
    // still render while users move to the next round.
    if (expiry < now - 2 * 60 * 60 * 1000) continue;

    out.push({
      oracle_id: id,
      expiry,
      status: expiry > now ? 'active' : 'settled',
      settled_at: expiry > now ? null : expiry,
      min_strike: '0',
      tick_size: String(market.tick_size ?? '1000000000'),
      underlying_asset: 'BTC',
      max_admission_leverage: market.max_admission_leverage != null ? String(market.max_admission_leverage) : undefined,
      admission_tick_size: market.admission_tick_size != null ? String(market.admission_tick_size) : undefined,
      created_ms: typeof market.created_ms === 'number' ? market.created_ms : undefined,
    });
  }

  const rank = (s: string) => (s === 'active' ? 0 : 1);
  out.sort((a, b) =>
    rank(a.status) - rank(b.status) || (rank(a.status) === 0 ? a.expiry - b.expiry : b.expiry - a.expiry),
  );

  marketCache = { data: out, ts: Date.now() };
  return out;
}

/** BTC spot straight off the PythFeed object.
 *
 *  propbook returns null for the 7-29 feed (verified 2026-08-06), the same way the beta indexer
 *  only knows 6-24. Reading the object is also the more honest number: it is the exact value the
 *  market prices and settles against, with no indexer hop in between. */
async function fetchSpot(): Promise<number | null> {
  try {
    const { SuiGrpcClient } = await import('@mysten/sui/grpc');
    const client = new SuiGrpcClient({ network: 'testnet', baseUrl: GRPC_URL });
    const res = await client.ledgerService.getObject({ objectId: PYTH_FEED, readMask: { paths: ['json'] } });

    // gRPC returns Move contents as protobuf Value wrappers; unwrap to plain JS.
    type PbValue = { kind?: { oneofKind?: string; [k: string]: unknown } };
    const un = (v: PbValue | undefined): unknown => {
      const k = v?.kind;
      if (!k) return undefined;
      switch (k.oneofKind) {
        case 'stringValue': return k.stringValue;
        case 'numberValue': return k.numberValue;
        case 'boolValue': return k.boolValue;
        case 'structValue': {
          const out: Record<string, unknown> = {};
          const fields = (k.structValue as { fields?: Record<string, PbValue> })?.fields ?? {};
          for (const [a, b] of Object.entries(fields)) out[a] = un(b);
          return out;
        }
        default: return undefined;
      }
    };

    const root = un(res.response?.object?.json as PbValue | undefined) as
      | { lane?: { latest?: { value?: Record<string, unknown> } } }
      | undefined;
    const v = root?.lane?.latest?.value;
    if (!v) return null;

    const exp = Number(v.exponent_magnitude);
    const scale = v.exponent_is_negative === false ? 10 ** exp : 10 ** -exp;
    const price = Number(v.price_magnitude) * scale * (v.price_is_negative ? -1 : 1);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function getMarkets(now: number): Promise<OracleEntry[]> {
  if (marketCache && now - marketCache.ts < MARKET_CACHE_TTL) return marketCache.data;
  // Stale-while-revalidate: a slow upstream never blanks a page that already has data.
  if (marketCache) {
    if (!marketInFlight) {
      marketInFlight = fetchMarkets().catch(() => marketCache!.data).finally(() => { marketInFlight = null; });
    }
    return marketCache.data;
  }
  if (marketInFlight) return marketInFlight;
  marketInFlight = fetchMarkets().finally(() => { marketInFlight = null; });
  return marketInFlight;
}

async function getSpot(now: number): Promise<number | null> {
  if (priceCache && now - priceCache.ts < PRICE_CACHE_TTL) return priceCache.data;
  const spot = await fetchSpot();
  priceCache = { data: spot, ts: Date.now() };
  return spot;
}

/**
 * ?prices=1 -> { oracles, prices }
 * otherwise -> oracle list
 */
export async function GET(request: Request) {
  const now = Date.now();
  const withPrices = new URL(request.url).searchParams.get('prices') === '1';

  try {
    const oracles = await getMarkets(now);
    if (!withPrices) return NextResponse.json(oracles, { headers: NO_STORE });
    const spot = await getSpot(now);
    const prices: Record<string, { spot: number }> = {};
    if (spot != null) for (const o of oracles) if (o.status === 'active') prices[o.oracle_id] = { spot };
    return NextResponse.json({ oracles, prices }, { headers: NO_STORE });
  } catch (err) {
    console.error('oracles route failed:', err);
    if (marketCache) {
      return NextResponse.json(withPrices ? { oracles: marketCache.data, prices: {} } : marketCache.data);
    }
    return NextResponse.json(withPrices ? { oracles: [], prices: {} } : [], { status: 502 });
  }
}

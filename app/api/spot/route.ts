// Live BTC spot for the browser, plus genuine price history for the sparklines.
//
// The browser used to read propbook, which indexes the 6-24 deployment only and answers 200 OK
// with [] for the 7-29 feed — no error, just nothing, which silently emptied spot, strike and
// odds across the markets page.
//
// History comes from `oracle_lane::ObservationRecorded`, the event the oracle emits on every
// observation of the settlement feed. This replaces a per-instance rolling buffer that started
// empty on every cold start, so a fresh visitor stared at a blank chart for ~20 seconds and each
// serverless instance disagreed with the next. These are the same observations the market prices
// and settles against, at full precision, with real timestamps.
import { NextResponse } from 'next/server';
import { PREDICT624 } from '@/lib/sui/predict624Client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const GRAPHQL_URL = 'https://graphql.testnet.sui.io/graphql';
const PROPBOOK_PKG = '0xed1295ff3c9a9415766afff20a74cdf2e362647be09aaf13b809302c0109e912';
const OBSERVATION_TYPE =
  `${PROPBOOK_PKG}::oracle_lane::ObservationRecorded<` +
  `${PROPBOOK_PKG}::oracle_lane::OracleRead<${PROPBOOK_PKG}::pyth_feed::RawSpot>>`;

const PAGE = 50;        // GraphQL hard cap
const MAX_PAGES = 4;    // ≈200 observations ≈ a few minutes of ticks, which is all a sparkline needs
const CACHE_TTL = 4_000;

interface Point { usd: number; tsMs: number }
let cache: { data: Point[]; ts: number } | null = null;

interface RawSpot {
  price_magnitude?: string;
  price_is_negative?: boolean;
  exponent_magnitude?: number | string;
  exponent_is_negative?: boolean;
}

function toUsd(v: RawSpot | undefined): number | null {
  if (!v) return null;
  const exp = Number(v.exponent_magnitude);
  const scale = v.exponent_is_negative === false ? 10 ** exp : 10 ** -exp;
  const usd = Number(v.price_magnitude) * scale * (v.price_is_negative ? -1 : 1);
  return Number.isFinite(usd) && usd > 0 ? usd : null;
}

/** Observations for OUR settlement feed, oldest-last (callers read .at(-1) for spot). */
async function fetchObservations(): Promise<Point[]> {
  const out: Point[] = [];
  let before: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const args = [`last: ${PAGE}`, `filter: { type: "${OBSERVATION_TYPE}" }`];
    if (before) args.push(`before: "${before}"`);
    const q = `{ events(${args.join(', ')}) { pageInfo { hasPreviousPage startCursor } nodes { contents { json } } } }`;
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q }), cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) break;
    const body = await res.json().catch(() => null);
    if (!body || body.errors) break;
    const conn = body.data?.events;

    for (const n of conn?.nodes ?? []) {
      const j = n?.contents?.json as
        | { propbook_oracle_id?: string; observation?: { source_timestamp_ms?: string; value?: RawSpot } }
        | undefined;
      // The lane carries every underlying, so keep only the feed our markets settle on.
      if (!j || j.propbook_oracle_id !== PREDICT624.pythFeed) continue;
      const usd = toUsd(j.observation?.value);
      const tsMs = Number(j.observation?.source_timestamp_ms);
      if (usd == null || !Number.isFinite(tsMs)) continue;
      out.push({ usd, tsMs });
    }
    if (!conn?.pageInfo?.hasPreviousPage || !conn.pageInfo.startCursor) break;
    before = conn.pageInfo.startCursor;
  }

  out.sort((a, b) => a.tsMs - b.tsMs);
  return out;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL && cache.data.length) {
    const last = cache.data[cache.data.length - 1];
    return NextResponse.json({ usd: last.usd, tsMs: last.tsMs, history: cache.data }, { headers: { 'cache-control': 'no-store' } });
  }

  const history = await fetchObservations();
  if (!history.length) {
    // Never invent a price. Empty is honest; stale or fabricated is not.
    return NextResponse.json({ usd: null, tsMs: null, history: [] }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  cache = { data: history, ts: Date.now() };
  const last = history[history.length - 1];
  return NextResponse.json({ usd: last.usd, tsMs: last.tsMs, history }, { headers: { 'cache-control': 'no-store' } });
}

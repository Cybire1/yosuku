// Markets + spot for the web app.
//
// This used to read `predict-server.testnet.mystenlabs.com`. That hostname no longer resolves
// (NXDOMAIN — Mysten retired the pre-6-24 indexer), so every request threw, the route answered
// 502, and the markets page went blank. It now reads the live beta indexer, which is the same
// source the mobile app already uses, and keeps the OUTPUT shape byte-compatible so nothing
// downstream has to change: `{ oracles: [{ oracle_id, expiry, status, ... }], prices: { id: { spot } } }`.
//
// The beta rows describe expiry markets, not the old "oracles", so status is derived from the
// clock rather than read from a field: a market is active until its expiry passes.
import { NextResponse } from 'next/server';

const INDEXER = 'https://predict-server-beta.testnet.mystenlabs.com';
const PROPBOOK = 'https://propbook.api.testnet.mystenlabs.com';
const PYTH_FEED = '0xc78d7de16217d46d21b92ae475da799448be30b71a758dc6d7bb3ac2f1c35afb';

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
}

interface Cached<T> { data: T; ts: number }
let marketCache: Cached<OracleEntry[]> | null = null;
let priceCache: Cached<number | null> | null = null;
let marketInFlight: Promise<OracleEntry[]> | null = null;

const j = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
};

async function fetchMarkets(): Promise<OracleEntry[]> {
  const rows = await j<Array<Record<string, unknown>>>(`${INDEXER}/markets`);
  const now = Date.now();
  const seen = new Set<string>();
  const out: OracleEntry[] = [];
  for (const m of Array.isArray(rows) ? rows : []) {
    const id = String(m.expiry_market_id ?? '');
    const expiry = Number(m.expiry);
    if (!id || !Number.isFinite(expiry) || seen.has(id)) continue;
    seen.add(id);
    // Keep recently-settled rounds around briefly so a just-closed market can still render.
    if (expiry < now - 2 * 60 * 60 * 1000) continue;
    out.push({
      oracle_id: id,
      expiry,
      status: expiry > now ? 'active' : 'settled',
      settled_at: expiry > now ? null : expiry,
      min_strike: '0',
      tick_size: String(m.tick_size ?? '1000000000'),
      underlying_asset: 'BTC',
      max_admission_leverage: m.max_admission_leverage != null ? String(m.max_admission_leverage) : undefined,
    });
  }
  const rank = (s: string) => (s === 'active' ? 0 : 1);
  out.sort((a, b) => rank(a.status) - rank(b.status) || (rank(a.status) === 0 ? a.expiry - b.expiry : b.expiry - a.expiry));
  marketCache = { data: out, ts: Date.now() };
  return out;
}

/** Live BTC spot from the settlement feed's HISTORY.
 *
 *  Deliberately not `/pyth/latest`: that endpoint currently returns a row about a day old while
 *  the history beside it is seconds fresh, so reading "latest" would put a stale price on the
 *  screen. The newest history row is the actual latest observation. */
async function fetchSpot(): Promise<number | null> {
  try {
    const rows = await j<Array<Record<string, unknown>>>(`${PROPBOOK}/oracles/${PYTH_FEED}/pyth?limit=1`);
    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r) return null;
    const exp = Number(r.exponent_magnitude);
    const scale = r.exponent_is_negative === false ? 10 ** exp : 10 ** -exp;
    const price = Number(r.price_magnitude) * scale * (r.price_is_negative ? -1 : 1);
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
 * ?prices=1 → { oracles, prices }
 * otherwise → oracle list
 */
export async function GET(request: Request) {
  const now = Date.now();
  const withPrices = new URL(request.url).searchParams.get('prices') === '1';

  try {
    const oracles = await getMarkets(now);
    if (!withPrices) return NextResponse.json(oracles);
    const spot = await getSpot(now);
    const prices: Record<string, { spot: number }> = {};
    if (spot != null) for (const o of oracles) if (o.status === 'active') prices[o.oracle_id] = { spot };
    return NextResponse.json({ oracles, prices });
  } catch (err) {
    console.error('oracles route failed:', err);
    if (marketCache) {
      return NextResponse.json(withPrices ? { oracles: marketCache.data, prices: {} } : marketCache.data);
    }
    return NextResponse.json(withPrices ? { oracles: [], prices: {} } : [], { status: 502 });
  }
}

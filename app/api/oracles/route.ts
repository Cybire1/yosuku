import { NextResponse } from 'next/server';

const PREDICT_BASE = 'https://predict-server.testnet.mystenlabs.com';
const ORACLE_CACHE_TTL = 5 * 60_000; // 5 minutes — oracles created every 15 min
const PRICE_CACHE_TTL = 10_000;       // 10 seconds for prices

interface OracleEntry {
  oracle_id: string;
  status: string;
  settled_at: number | null;
  expiry: number;
  [key: string]: unknown;
}

interface Cached<T> { data: T; ts: number; }

let oracleCache: Cached<OracleEntry[]> | null = null;
let priceCache: Cached<Record<string, unknown>> | null = null;
let oracleInFlight: Promise<OracleEntry[]> | null = null;
let priceInFlight: Promise<Record<string, unknown>> | null = null;

function filterRelevant(all: OracleEntry[]): OracleEntry[] {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  return all.filter(o =>
    o.status === 'active' ||
    o.status === 'pending_settlement' ||
    (o.status === 'settled' && (o.settled_at ?? o.expiry) > cutoff)
  );
}

async function fetchOraclesFromUpstream(): Promise<OracleEntry[]> {
  // Cold-cache failures surface straight to the browser as 502s, so absorb
  // transient upstream blips here: bounded timeout + two retries with backoff.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${PREDICT_BASE}/oracles`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Upstream oracles: ${res.status}`);
      const all: OracleEntry[] = await res.json();
      const relevant = filterRelevant(all);
      oracleCache = { data: relevant, ts: Date.now() };
      return relevant;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Stale-while-revalidate: return stale data instantly, refresh in background */
async function getOracles(now: number): Promise<OracleEntry[]> {
  if (oracleCache && now - oracleCache.ts < ORACLE_CACHE_TTL) return oracleCache.data;

  if (oracleCache) {
    // Stale — return immediately, background refresh
    if (!oracleInFlight) {
      oracleInFlight = fetchOraclesFromUpstream()
        .catch(() => oracleCache!.data)
        .finally(() => { oracleInFlight = null; });
    }
    return oracleCache.data;
  }

  // Cold — must wait
  if (oracleInFlight) return oracleInFlight;
  oracleInFlight = fetchOraclesFromUpstream()
    .finally(() => { oracleInFlight = null; });
  return oracleInFlight;
}

async function fetchPrice(oracleId: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${PREDICT_BASE}/oracles/${oracleId}/prices/latest`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchAllPrices(oracles: OracleEntry[]): Promise<Record<string, unknown>> {
  const prices: Record<string, unknown> = {};
  const activeIds = oracles.filter(o => o.status === 'active').map(o => o.oracle_id);
  const results = await Promise.allSettled(activeIds.map(id => fetchPrice(id)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) prices[activeIds[i]] = r.value;
  });
  return prices;
}

async function getPrices(oracles: OracleEntry[], now: number): Promise<Record<string, unknown>> {
  if (priceCache && now - priceCache.ts < PRICE_CACHE_TTL) return priceCache.data;

  if (priceCache) {
    if (!priceInFlight) {
      priceInFlight = fetchAllPrices(oracles)
        .then(p => { priceCache = { data: p, ts: Date.now() }; return p; })
        .catch(() => priceCache!.data)
        .finally(() => { priceInFlight = null; });
    }
    return priceCache.data;
  }

  if (priceInFlight) return priceInFlight;
  priceInFlight = fetchAllPrices(oracles)
    .then(p => { priceCache = { data: p, ts: Date.now() }; return p; })
    .finally(() => { priceInFlight = null; });
  return priceInFlight;
}

/**
 * Combined oracles + prices endpoint.
 * ?prices=1 → { oracles, prices }
 * Otherwise → oracle list
 *
 * Stale-while-revalidate caching. Cold cache ~2-3s, warm ~10ms.
 */
export async function GET(request: Request) {
  const now = Date.now();
  const url = new URL(request.url);
  const withPrices = url.searchParams.get('prices') === '1';

  try {
    const oracles = await getOracles(now);
    if (!withPrices) return NextResponse.json(oracles);

    const prices = await getPrices(oracles, now);
    return NextResponse.json({ oracles, prices });
  } catch (err) {
    console.error('Failed to fetch oracles:', err);
    if (oracleCache) {
      return NextResponse.json(
        withPrices
          ? { oracles: oracleCache.data, prices: priceCache?.data ?? {} }
          : oracleCache.data
      );
    }
    return NextResponse.json(withPrices ? { oracles: [], prices: {} } : [], { status: 502 });
  }
}

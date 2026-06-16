import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'node:fs/promises';

const PREDICT_BASE = 'https://predict-server.testnet.mystenlabs.com';
const ORACLE_CACHE_TTL = 30_000;      // 15-minute rounds need a short market-list cache
const PRICE_CACHE_TTL = 10_000;       // 10 seconds for prices
const ORACLE_COLD_TIMEOUT_MS = 30_000; // /oracles is ~2MB and can be slow on cold local dev
const PRICE_TIMEOUT_MS = 8_000;
const ORACLE_DISK_CACHE = '/tmp/yosuku-predict-oracles-cache.json';

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
  const now = Date.now();
  const cutoff = now - 2 * 60 * 60 * 1000;
  const activeGrace = now - 2 * 60_000;
  const rank = (status: string) =>
    status === 'active' ? 0 : status === 'pending_settlement' ? 1 : 2;

  return all
    .filter(o =>
      (o.status === 'active' && o.expiry > activeGrace) ||
      o.status === 'pending_settlement' ||
      (o.status === 'settled' && (o.settled_at ?? o.expiry) > cutoff)
    )
    .sort((a, b) => {
      const ar = rank(a.status);
      const br = rank(b.status);
      if (ar !== br) return ar - br;
      return ar === 2
        ? (b.settled_at ?? b.expiry) - (a.settled_at ?? a.expiry)
        : a.expiry - b.expiry;
    });
}

async function fetchOraclesFromUpstream(): Promise<OracleEntry[]> {
  // /oracles is large (~2MB). On local dev, three long retries can make the
  // markets page look dead, so cold loads get one generous attempt. Warm loads
  // are protected by stale-while-revalidate below.
  const res = await fetch(`${PREDICT_BASE}/oracles`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(ORACLE_COLD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Upstream oracles: ${res.status}`);
  const all: OracleEntry[] = await res.json();
  const relevant = filterRelevant(all);
  oracleCache = { data: relevant, ts: Date.now() };
  void writeFile(ORACLE_DISK_CACHE, JSON.stringify(relevant)).catch(() => {});
  return relevant;
}

async function getDiskOracles(): Promise<OracleEntry[] | null> {
  try {
    const raw = await readFile(ORACLE_DISK_CACHE, 'utf8');
    const parsed = JSON.parse(raw) as OracleEntry[];
    const relevant = filterRelevant(parsed);
    if (relevant.length === 0) return null;
    oracleCache = { data: relevant, ts: Date.now() };
    return relevant;
  } catch {
    return null;
  }
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

  const disk = await getDiskOracles();
  if (disk) {
    if (!oracleInFlight) {
      oracleInFlight = fetchOraclesFromUpstream()
        .catch(() => disk)
        .finally(() => { oracleInFlight = null; });
    }
    return disk;
  }

  // Cold — must wait
  if (oracleInFlight) return oracleInFlight;
  oracleInFlight = fetchOraclesFromUpstream()
    .finally(() => { oracleInFlight = null; });
  return oracleInFlight;
}

async function fetchPrice(oracleId: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${PREDICT_BASE}/oracles/${oracleId}/prices/latest`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
    });
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
    const disk = await getDiskOracles();
    if (disk) {
      return NextResponse.json(withPrices ? { oracles: disk, prices: priceCache?.data ?? {} } : disk);
    }
    return NextResponse.json(withPrices ? { oracles: [], prices: {} } : [], { status: 502 });
  }
}

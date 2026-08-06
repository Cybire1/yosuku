// Live BTC spot for the browser, plus a short rolling history for the sparklines.
//
// The browser used to read propbook directly. That host only knows the 6-24 deployment and
// answers 200 OK with [] for the 7-29 feed, which silently emptied spot, strike and odds across
// the markets page. This reads the settlement feed on chain instead.
//
// The history buffer is best-effort by construction: it lives in module scope, so it starts empty
// on a cold start and is per-instance. That is fine — it feeds a decorative sparkline, and every
// consumer already handles a short series. Spot itself is always a fresh read.
import { NextResponse } from 'next/server';
import { readOnchainSpot, type SpotReading } from '@/lib/sui/onchainSpot';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_POINTS = 240;
const MIN_GAP_MS = 2_000;
const buffer: SpotReading[] = []; // oldest-first

export async function GET() {
  const reading = await readOnchainSpot();
  if (!reading) {
    // Never invent a price. An empty payload is honest; a stale or made-up one is not.
    return NextResponse.json(
      { usd: null, tsMs: null, history: buffer },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const last = buffer[buffer.length - 1];
  if (!last || reading.tsMs - last.tsMs >= MIN_GAP_MS) {
    buffer.push(reading);
    if (buffer.length > MAX_POINTS) buffer.splice(0, buffer.length - MAX_POINTS);
  }

  return NextResponse.json(
    { usd: reading.usd, tsMs: reading.tsMs, history: buffer },
    { headers: { 'cache-control': 'no-store' } },
  );
}

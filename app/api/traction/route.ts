// Cached traction counts — a cheap, fast read of the numbers the /stats page proves.
//
// fetchTraction() walks up to 40 GraphQL pages, which is far too slow for anything on a
// hot path (a link preview render, for instance). This route pays that cost at most once
// every REVALIDATE seconds and hands back just the two headline numbers, so callers get a
// single fast request instead of forty.
//
// Honest by construction: both numbers come straight from the chain, and Yosuku's own
// infra/test wallets are excluded upstream in fetchTraction.
import { NextResponse } from 'next/server';
import { fetchTraction } from '@/lib/sui/traction';

// Next requires this to be a literal, so the value is repeated in the header below.
export const revalidate = 900;

export async function GET() {
  try {
    const t = await fetchTraction();
    return NextResponse.json(
      { wallets: t.onboardedUsers, actions: t.sponsoredActions, updatedAt: t.updatedAt },
      { headers: { 'cache-control': 'public, s-maxage=900, stale-while-revalidate=86400' } },
    );
  } catch {
    // Never 500 a consumer that only wants a number to render — let it use its own floor.
    return NextResponse.json({ wallets: null, actions: null }, { status: 200 });
  }
}

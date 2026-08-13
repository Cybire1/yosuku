// Cached traction counts — a cheap, fast read of the numbers the /stats page proves.
//
// fetchTraction() walks the full history of Yosuku-sponsored transactions, which takes ~20s and
// is far too slow for anything on a hot path (a link preview render, for instance). This route
// pays that cost at most once every REVALIDATE seconds and hands back the headline numbers, so
// callers get a single fast request instead of hundreds.
//
// Honest by construction: both numbers come straight from the chain, and Yosuku's own
// infra/test wallets are excluded upstream in fetchTraction.
import { NextResponse } from 'next/server';
import { fetchTraction } from '@/lib/sui/traction';

// Never prerendered. The walk takes ~20s of live GraphQL and the build tries to generate it
// inside a 60s budget, which fails the whole build. It is a live counter; it belongs on request.
export const dynamic = 'force-dynamic';
// A cold call is ~20s of paging. It is cached for 15 minutes, but the cold path still has to be
// allowed to finish rather than being killed at the platform default.
export const maxDuration = 120;

export async function GET() {
  try {
    const t = await fetchTraction();
    return NextResponse.json(
      {
        wallets: t.onboardedUsers,
        actions: t.sponsoredActions,
        // Volume never ships without its bettor count; see the note in traction.ts.
        bets: t.bets.count,
        staked: t.bets.volumeDusdc,
        bettors: t.bets.bettors,
        updatedAt: t.updatedAt,
      },
      { headers: { 'cache-control': 'public, s-maxage=900, stale-while-revalidate=86400' } },
    );
  } catch {
    // Never 500 a consumer that only wants a number to render — let it use its own floor.
    return NextResponse.json({ wallets: null, actions: null, bets: null, staked: null, bettors: null }, { status: 200 });
  }
}

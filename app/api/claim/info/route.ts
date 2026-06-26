import { NextRequest, NextResponse } from 'next/server';

// Proxies the claim lookup to the relay (which holds the auto-account store + admin key + watches the
// proof tweet). Until CLAIM_EXECUTOR_URL is configured, returns "no account" so the page degrades cleanly.
const RELAY = process.env.CLAIM_EXECUTOR_URL;        // e.g. http://100.54.126.119:8789
const SECRET = process.env.CLAIM_SHARED_SECRET || '';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet) return NextResponse.json({ error: 'wallet required' }, { status: 400 });
  if (!RELAY) return NextResponse.json({ account: null }, { status: 200 });
  try {
    const r = await fetch(`${RELAY}/claim/info?wallet=${encodeURIComponent(wallet)}`, {
      headers: SECRET ? { 'x-claim-secret': SECRET } : {},
      cache: 'no-store',
    });
    if (r.status === 404) return NextResponse.json({ account: null }, { status: 404 });
    if (!r.ok) return NextResponse.json({ account: null }, { status: 502 });
    const j = await r.json();
    return NextResponse.json({ account: j.account ?? null });
  } catch {
    return NextResponse.json({ account: null }, { status: 502 });
  }
}

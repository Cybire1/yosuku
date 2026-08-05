import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readSession } from '@/lib/claimOAuth';

export const dynamic = 'force-dynamic';

const RELAY = process.env.CLAIM_EXECUTOR_URL;
const SECRET = process.env.CLAIM_SHARED_SECRET || '';
const authHeaders = (): Record<string, string> => (SECRET ? { 'x-claim-secret': SECRET } : {});

// Who signed in with X, and what they have waiting (relay looks the auto-account up by authorId).
//
// Two sources, deliberately. The OAuth session says who is signed in RIGHT HERE; the relay's
// binding says which X account actually routes its bets to a wallet, on any device. Reading only
// the session made the portfolio tell people they were unlinked whenever the cookie was missing or
// expired, even though the relay knew otherwise. Pass ?wallet= to get the binding without a cookie.
export async function GET(req: NextRequest) {
  const sess = readSession((await cookies()).get('x_sess')?.value);
  const wallet = req.nextUrl.searchParams.get('wallet');

  const bindingFor = async (w: string | null) => {
    if (!RELAY || !w) return null;
    try {
      const r = await fetch(`${RELAY}/claim/by-address?wallet=${encodeURIComponent(w)}`, { headers: authHeaders(), cache: 'no-store' });
      return r.ok ? ((await r.json())?.binding ?? null) : null;
    } catch { return null; }
  };

  // No session: fall back to the durable binding for this wallet, if we were given one.
  // signedIn:false, because we know the binding but not that this browser IS that account, so
  // anything needing proof of identity (linking, claiming) still asks for a sign-in first.
  if (!sess?.authorId) {
    const binding = await bindingFor(wallet);
    if (binding?.handle) {
      return NextResponse.json({ handle: binding.handle, authorId: binding.authorId ?? null, account: null, binding, signedIn: false });
    }
    return NextResponse.json({ handle: null }, { status: 401 });
  }

  let account = null;
  let handle = sess.handle ?? null;
  if (RELAY) {
    try {
      const r = await fetch(`${RELAY}/claim/by-author?authorId=${encodeURIComponent(sess.authorId)}`, {
        headers: authHeaders(), cache: 'no-store',
      });
      if (r.ok) { const j = await r.json(); account = j.account ?? null; handle = j.handle || handle; }
    } catch { /* no account yet */ }
  }

  // "Signed in with X" and "tweets reach this balance" are different facts, and only the second
  // one lets a bet work. The card needs both so it can offer to link when they disagree.
  const binding = await bindingFor(wallet);
  return NextResponse.json({ authorId: sess.authorId, handle, account, binding, signedIn: true });
}

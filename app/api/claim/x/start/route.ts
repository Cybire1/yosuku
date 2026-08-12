import { NextRequest, NextResponse } from 'next/server';
import { genVerifier, codeChallenge, genState } from '@/lib/claimOAuth';

export const dynamic = 'force-dynamic';

// Kick off "Sign in with X" / "Connect X": PKCE + state in short-lived httpOnly cookies, then
// redirect to X. Optional ?return=/path controls where the callback lands (default /claim).
export async function GET(req: NextRequest) {
  const ret = req.nextUrl.searchParams.get('return');
  const safeRet = ret && ret.startsWith('/') && !ret.startsWith('//') ? ret : '';
  const clientId = process.env.TWITTER_CLIENT_ID;
  const redirect = process.env.CLAIM_X_REDIRECT || 'https://yosuku.xyz/api/claim/x/callback';
  if (!clientId) return NextResponse.json({ error: 'Sign in with X is not configured yet.' }, { status: 500 });

  // PKCE/state cookies must be written on the same origin that receives the X callback. A user
  // can enter through www, a Vercel preview, or localhost while X is registered to yosuku.xyz.
  // Starting OAuth on that first host writes cookies the callback can never read, so X appears to
  // authorize successfully and the portfolio immediately asks them to connect again. Move the
  // start request to the registered callback origin before creating any OAuth state.
  const callbackOrigin = new URL(redirect).origin;
  if (req.nextUrl.origin !== callbackOrigin) {
    const canonicalStart = new URL('/api/claim/x/start', callbackOrigin);
    if (safeRet) canonicalStart.searchParams.set('return', safeRet);
    return NextResponse.redirect(canonicalStart);
  }

  const verifier = genVerifier();
  const state = genState();
  const url = new URL('https://twitter.com/i/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('scope', 'users.read tweet.read');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');

  const res = NextResponse.redirect(url.toString());
  const opts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 600 };
  res.cookies.set('x_v', verifier, opts);
  res.cookies.set('x_s', state, opts);
  if (safeRet) res.cookies.set('x_ret', safeRet, opts);
  return res;
}

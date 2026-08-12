import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { signSession, SESSION_TTL_MS } from '@/lib/claimOAuth';

export const dynamic = 'force-dynamic';

// X redirects here with ?code&state. Exchange for a token, read the handle+id, stash a signed
// session, and bounce back to /claim?x=1 where the page reveals what's waiting.
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const ret = jar.get('x_ret')?.value;
  const home = ret && ret.startsWith('/') && !ret.startsWith('//') ? `${new URL(req.url).origin}${ret}` : (process.env.CLAIM_HOME || 'https://yosuku.xyz/claim');
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const verifier = jar.get('x_v')?.value;
  const savedState = jar.get('x_s')?.value;
  const withResult = (result: '1' | 'err', reason?: string) => {
    const url = new URL(home);
    url.searchParams.set('x', result);
    if (reason) url.searchParams.set('x_reason', reason);
    return url.toString();
  };
  if (!code || !state) return NextResponse.redirect(withResult('err', 'denied'));
  if (!verifier || !savedState || state !== savedState) return NextResponse.redirect(withResult('err', 'state'));

  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  const redirect = process.env.CLAIM_X_REDIRECT || 'https://yosuku.xyz/api/claim/x/callback';
  if (!clientId) return NextResponse.redirect(withResult('err', 'config'));

  try {
    // X supports both confidential web clients (Basic client authentication) and public PKCE
    // clients (client_id in the request body). Sending `Basic base64(clientId:undefined)` made a
    // correctly configured public client fail only after the user had approved access.
    const tokenResponse = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(clientSecret ? { authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64') } : {}),
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier, client_id: clientId }),
      cache: 'no-store',
    });
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !token?.access_token) {
      console.error('X OAuth token exchange failed', { status: tokenResponse.status, code: token?.error || 'unknown' });
      return NextResponse.redirect(withResult('err', 'token'));
    }

    const meResponse = await fetch('https://api.x.com/2/users/me', {
      headers: { authorization: `Bearer ${token.access_token}` },
      cache: 'no-store',
    });
    const me = await meResponse.json().catch(() => ({}));
    const id = me?.data?.id;
    const username = me?.data?.username;
    if (!meResponse.ok || !id) {
      console.error('X OAuth profile lookup failed', { status: meResponse.status });
      return NextResponse.redirect(withResult('err', 'profile'));
    }

    const res = NextResponse.redirect(withResult('1'));
    // 30 days, not 30 minutes, and read from the same constant readSession enforces so the two
    // can't drift apart (the shorter of the pair always wins). The old half-hour expiry meant the
    // portfolio told returning users "Connect X first" on nearly every visit, including people who
    // were already linked and funded, because the cookie was all that page could read. Still
    // httpOnly + secure + sameSite; the binding itself lives on the relay, so this only governs
    // how long the browser can prove which account it is.
    res.cookies.set('x_sess', signSession({ authorId: String(id), handle: username || null, t: Date.now() }), {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    res.cookies.delete('x_v');
    res.cookies.delete('x_s');
    res.cookies.delete('x_ret');
    return res;
  } catch (error) {
    console.error('X OAuth callback failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.redirect(withResult('err', 'server'));
  }
}

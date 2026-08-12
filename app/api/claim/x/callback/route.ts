import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { signSession, SESSION_TTL_MS } from '@/lib/claimOAuth';

export const dynamic = 'force-dynamic';

type TokenResult = {
  response: Response;
  payload: Record<string, unknown>;
  mode: 'confidential' | 'public';
};

async function exchangeCode(input: {
  clientId: string;
  clientSecret?: string;
  code: string;
  redirect: string;
  verifier: string;
}): Promise<TokenResult> {
  const request = async (mode: TokenResult['mode']): Promise<TokenResult> => {
    const confidential = mode === 'confidential';
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirect,
      code_verifier: input.verifier,
    });
    // X's confidential-client example authenticates only through Basic auth. Public PKCE clients
    // authenticate by putting client_id in the body. Keep the request shapes distinct.
    if (!confidential) body.set('client_id', input.clientId);

    const response = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(confidential
          ? { authorization: 'Basic ' + Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64') }
          : {}),
      },
      body,
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, payload, mode };
  };

  if (!input.clientSecret) return request('public');

  const confidential = await request('confidential');
  if (confidential.response.ok && confidential.payload.access_token) return confidential;

  // A public X app can still have an unrelated/stale secret in deployment settings. Invalid
  // client authentication does not authorize anything, so retry the same PKCE exchange using the
  // public-client request shape before asking the user to start over.
  const error = String(confidential.payload.error || '');
  if (confidential.response.status === 401 || error === 'invalid_client' || error === 'unauthorized_client') {
    return request('public');
  }
  return confidential;
}

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
    const tokenResult = await exchangeCode({ clientId, clientSecret, code, redirect, verifier });
    const token = tokenResult.payload;
    if (!tokenResult.response.ok || !token.access_token) {
      const errorCode = String(token.error || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 48);
      console.error('X OAuth token exchange failed', {
        status: tokenResult.response.status,
        code: errorCode,
        mode: tokenResult.mode,
      });
      return NextResponse.redirect(withResult('err', `token_${errorCode || 'unknown'}`));
    }

    const meResponse = await fetch('https://api.x.com/2/users/me', {
      headers: { authorization: `Bearer ${String(token.access_token)}` },
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

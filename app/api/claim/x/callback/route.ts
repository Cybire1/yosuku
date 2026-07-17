import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { signSession } from '@/lib/claimOAuth';

export const dynamic = 'force-dynamic';

// X redirects here with ?code&state. Exchange for a token, read the handle+id, stash a signed
// session, and bounce back to /claim?x=1 where the page reveals what's waiting.
export async function GET(req: NextRequest) {
  const home = process.env.CLAIM_HOME || 'https://yosuku.xyz/claim';
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const jar = await cookies();
  const verifier = jar.get('x_v')?.value;
  const savedState = jar.get('x_s')?.value;
  if (!code || !state || !verifier || state !== savedState) return NextResponse.redirect(`${home}?x=err`);

  const clientId = process.env.TWITTER_CLIENT_ID!;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET!;
  const redirect = process.env.CLAIM_X_REDIRECT || 'https://yosuku.xyz/api/claim/x/callback';

  try {
    const token = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier, client_id: clientId }),
    }).then((r) => r.json());
    if (!token?.access_token) return NextResponse.redirect(`${home}?x=err`);

    const me = await fetch('https://api.twitter.com/2/users/me', { headers: { authorization: `Bearer ${token.access_token}` } }).then((r) => r.json());
    const id = me?.data?.id;
    const username = me?.data?.username;
    if (!id) return NextResponse.redirect(`${home}?x=err`);

    const res = NextResponse.redirect(`${home}?x=1`);
    res.cookies.set('x_sess', signSession({ authorId: String(id), handle: username || null, t: Date.now() }), {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 1800,
    });
    res.cookies.delete('x_v');
    res.cookies.delete('x_s');
    return res;
  } catch {
    return NextResponse.redirect(`${home}?x=err`);
  }
}

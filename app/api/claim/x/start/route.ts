import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { genVerifier, codeChallenge, genState } from '@/lib/claimOAuth';

export const dynamic = 'force-dynamic';

// Kick off "Sign in with X": PKCE + state stashed in short-lived httpOnly cookies, then redirect to X.
export async function GET() {
  const clientId = process.env.TWITTER_CLIENT_ID;
  const redirect = process.env.CLAIM_X_REDIRECT || 'https://yosuku.xyz/api/claim/x/callback';
  if (!clientId) return NextResponse.json({ error: 'Sign in with X is not configured yet.' }, { status: 500 });

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
  return res;
}

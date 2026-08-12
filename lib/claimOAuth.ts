// Helpers for the claim "Sign in with X" flow (OAuth2 + PKCE) and a tamper-proof session cookie.
// The signed session carries the X authorId the relay binds to — the client never supplies it.
import { createHash, createHmac, randomBytes } from 'node:crypto';

const b64url = (b: Buffer) => b.toString('base64url');
// This HMAC signs the session cookie carrying the X authorId, and app/api/claim/bind trusts that
// authorId precisely BECAUSE it is signed. A fallback literal in a public repo therefore lets
// anyone mint a session for any handle and bind someone else's tweet-funded account to their own
// wallet. There is no safe default for a key whose whole job is being unguessable, so refuse.
const secret = () => {
  // Prefer a dedicated session key. Existing deployments already need CLAIM_SHARED_SECRET to
  // authenticate the private relay, so use a domain-separated derivative as a secure migration
  // fallback rather than making X OAuth fail after the user has approved it. Never use a literal
  // or public fallback here.
  const s = process.env.CLAIM_SESSION_SECRET || (process.env.CLAIM_SHARED_SECRET
    ? createHash('sha256').update(`yosuku:x-session:v1:${process.env.CLAIM_SHARED_SECRET}`).digest('hex')
    : '');
  if (!s) throw new Error('CLAIM_SESSION_SECRET is not set');
  return s;
};

export const genVerifier = () => b64url(randomBytes(32));
export const codeChallenge = (v: string) => b64url(createHash('sha256').update(v).digest());
export const genState = () => b64url(randomBytes(16));

export function signSession(payload: Record<string, unknown>): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// Must match the cookie's maxAge in app/api/claim/x/callback. Two expiries govern this session,
// the cookie's and this one, and the shorter always wins: raising only the cookie changes nothing.
// It was 30 minutes, which is a fine lifetime for a one-shot claim flow and a bad one for the
// portfolio, where the same session is what tells a returning user their X account is connected.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days

// Only authorId and handle are ever read off this, so name them instead of returning a bag of any.
export type XSession = { authorId: string; handle: string | null; t?: number };

export function readSession(token?: string): XSession | null {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  if (sig.length !== expected.length || expected !== sig) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.t && Date.now() - p.t > SESSION_TTL_MS) return null;
    return p;
  } catch { return null; }
}

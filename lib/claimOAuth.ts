// Helpers for the claim "Sign in with X" flow (OAuth2 + PKCE) and a tamper-proof session cookie.
// The signed session carries the X authorId the relay binds to — the client never supplies it.
import { createHash, createHmac, randomBytes } from 'node:crypto';

const b64url = (b: Buffer) => b.toString('base64url');
const secret = () => process.env.CLAIM_SESSION_SECRET || 'dev-insecure-change-me';

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

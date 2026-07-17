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

export function readSession(token?: string): Record<string, any> | null {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  if (sig.length !== expected.length || expected !== sig) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.t && Date.now() - p.t > 30 * 60_000) return null; // 30-min session
    return p;
  } catch { return null; }
}

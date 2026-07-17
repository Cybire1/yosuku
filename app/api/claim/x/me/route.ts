import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readSession } from '@/lib/claimOAuth';

export const dynamic = 'force-dynamic';

const RELAY = process.env.CLAIM_EXECUTOR_URL;
const SECRET = process.env.CLAIM_SHARED_SECRET || '';

// Who signed in with X, and what they have waiting (relay looks the auto-account up by authorId).
export async function GET() {
  const sess = readSession((await cookies()).get('x_sess')?.value);
  if (!sess?.authorId) return NextResponse.json({ handle: null }, { status: 401 });

  let account = null;
  let handle = sess.handle ?? null;
  if (RELAY) {
    try {
      const r = await fetch(`${RELAY}/claim/by-author?authorId=${encodeURIComponent(sess.authorId)}`, {
        headers: SECRET ? { 'x-claim-secret': SECRET } : {}, cache: 'no-store',
      });
      if (r.ok) { const j = await r.json(); account = j.account ?? null; handle = j.handle || handle; }
    } catch { /* no account yet */ }
  }
  return NextResponse.json({ authorId: sess.authorId, handle, account });
}

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readSession } from '@/lib/claimOAuth';

export const dynamic = 'force-dynamic';

const RELAY = process.env.CLAIM_EXECUTOR_URL;
const SECRET = process.env.CLAIM_SHARED_SECRET || '';

// Bind the signed-in X handle to the connected wallet on-chain (relay does set_owner). The authorId
// comes from the SIGNED session (set by OAuth), never from the client — so a caller can only ever
// bind their own handle.
export async function POST(req: NextRequest) {
  const sess = readSession((await cookies()).get('x_sess')?.value);
  if (!sess?.authorId) return NextResponse.json({ ok: false, reason: 'sign in with X first' }, { status: 401 });

  const { wallet } = await req.json().catch(() => ({}));
  if (!/^0x[0-9a-fA-F]{6,66}$/.test(String(wallet || ''))) return NextResponse.json({ ok: false, reason: 'invalid wallet' }, { status: 400 });
  if (!RELAY) return NextResponse.json({ ok: false, reason: 'relay not configured' }, { status: 500 });

  try {
    const r = await fetch(`${RELAY}/claim/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(SECRET ? { 'x-claim-secret': SECRET } : {}) },
      body: JSON.stringify({ authorId: sess.authorId, wallet }),
    });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json(j, { status: r.ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, reason: 'bind failed, try again' }, { status: 502 });
  }
}

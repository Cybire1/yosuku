import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { readSession } from '@/lib/claimOAuth';
import { xUnlinkMessage } from '@/lib/xLink';

export const dynamic = 'force-dynamic';

const SUI_GRAPHQL = new SuiGraphQLClient({
  url: process.env.NEXT_PUBLIC_SUI_GRAPHQL_URL || 'https://graphql.testnet.sui.io/graphql',
  network: 'testnet',
});

const RELAY = process.env.CLAIM_EXECUTOR_URL;
const SECRET = process.env.CLAIM_SHARED_SECRET || '';

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const sess = readSession(jar.get('x_sess')?.value);
  if (!sess?.authorId) return NextResponse.json({ ok: false, reason: 'verify the linked X account first' }, { status: 401 });

  const { wallet, signature } = await req.json().catch(() => ({}));
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(wallet || ''))) return NextResponse.json({ ok: false, reason: 'invalid wallet' }, { status: 400 });
  if (typeof signature !== 'string' || !signature) return NextResponse.json({ ok: false, reason: 'wallet signature required' }, { status: 401 });
  if (!RELAY) return NextResponse.json({ ok: false, reason: 'relay not configured' }, { status: 500 });

  try {
    await verifyPersonalMessageSignature(
      xUnlinkMessage(sess.authorId, String(wallet)),
      signature,
      { address: String(wallet).toLowerCase(), client: SUI_GRAPHQL },
    );
  } catch {
    return NextResponse.json({ ok: false, reason: 'wallet signature did not match' }, { status: 401 });
  }

  try {
    const relayResponse = await fetch(`${RELAY}/claim/unlink`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(SECRET ? { 'x-claim-secret': SECRET } : {}) },
      body: JSON.stringify({ authorId: sess.authorId, wallet }),
    });
    const body = await relayResponse.json().catch(() => ({}));
    const response = NextResponse.json(body, { status: relayResponse.ok ? 200 : 400 });
    if (relayResponse.ok) response.cookies.delete('x_sess');
    return response;
  } catch {
    return NextResponse.json({ ok: false, reason: 'disconnect failed, try again' }, { status: 502 });
  }
}

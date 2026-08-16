import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { readSession } from '@/lib/claimOAuth';
import { xLinkMessage } from '@/lib/xLink';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { SuiGraphQLClient } from '@mysten/sui/graphql';

export const dynamic = 'force-dynamic';

const RELAY = process.env.CLAIM_EXECUTOR_URL;
const SECRET = process.env.CLAIM_SHARED_SECRET || '';
const SUI_GRAPHQL = new SuiGraphQLClient({
  url: process.env.NEXT_PUBLIC_SUI_GRAPHQL_URL || 'https://graphql.testnet.sui.io/graphql',
  network: 'testnet',
});

// Point the signed-in X account at the connected wallet, so a reply the relay reads actually
// resolves to this person's own funded balance.
//
// Distinct from /api/claim/bind, which calls the relay's /claim/bind and only ever CLAIMS a sealed
// auto-account (it refuses anyone without one). That left the ordinary path broken: someone could
// sign in with X on the portfolio, fund an X balance, and still have every tweet land unrouted,
// because nothing wrote authorId → their address. This is the endpoint that writes it.
//
// The authorId comes from the SIGNED session, never the client, so a caller can only ever link
// their own handle. The relay decides claim-vs-link and protects sealed balances.
export async function POST(req: NextRequest) {
  const sess = readSession((await cookies()).get('x_sess')?.value);
  if (!sess?.authorId) return NextResponse.json({ ok: false, reason: 'sign in with X first' }, { status: 401 });

  const { wallet, signature } = await req.json().catch(() => ({}));
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(wallet || ''))) return NextResponse.json({ ok: false, reason: 'invalid wallet' }, { status: 400 });
  if (typeof signature !== 'string' || !signature) return NextResponse.json({ ok: false, reason: 'wallet signature required' }, { status: 401 });
  if (!RELAY) return NextResponse.json({ ok: false, reason: 'relay not configured' }, { status: 500 });

  try {
    // zkLogin personal-message signatures are verified by Sui's GraphQL API; unlike ordinary
    // key signatures they cannot be checked locally. Passing only `address` made every Google
    // wallet fail here even though the wallet had signed the exact link message.
    await verifyPersonalMessageSignature(xLinkMessage(sess.authorId, String(wallet)), signature, {
      address: String(wallet).toLowerCase(),
      client: SUI_GRAPHQL,
    });
  } catch {
    return NextResponse.json({ ok: false, reason: 'wallet signature did not match' }, { status: 401 });
  }

  try {
    const r = await fetch(`${RELAY}/claim/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(SECRET ? { 'x-claim-secret': SECRET } : {}) },
      body: JSON.stringify({ authorId: sess.authorId, handle: sess.handle ?? null, wallet }),
    });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json(j, { status: r.ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, reason: 'link failed, try again' }, { status: 502 });
  }
}

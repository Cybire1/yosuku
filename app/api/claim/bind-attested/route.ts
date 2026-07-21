import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const RELAY = process.env.CLAIM_EXECUTOR_URL;
const SECRET = process.env.CLAIM_SHARED_SECRET || '';

// Attested bind: forward the ENCLAVE-MINTED bind token to the relay. The token IS the authority — the
// enclave verified the X handle AND the committed wallet in-TEE and signed over both; the relay only
// pays gas and the chain checks the signature. Nothing here (handle or wallet) comes from the client:
// both are sealed inside the signed token, so this route can't be used to bind someone else's account.
export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({}));
  if (!token || typeof token !== 'string') return NextResponse.json({ ok: false, reason: 'missing bind token' }, { status: 400 });
  if (!RELAY) return NextResponse.json({ ok: false, reason: 'relay not configured' }, { status: 500 });

  try {
    const r = await fetch(`${RELAY}/claim/bind-attested`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(SECRET ? { 'x-claim-secret': SECRET } : {}) },
      body: JSON.stringify({ token }),
    });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json(j, { status: r.ok ? 200 : 400 });
  } catch {
    return NextResponse.json({ ok: false, reason: 'bind failed, try again' }, { status: 502 });
  }
}

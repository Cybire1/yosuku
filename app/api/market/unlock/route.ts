// Unlock = Seal decryption of a purchased playbook. Seal needs @mysten/sui 2.x,
// which conflicts with this app's 1.24 (pinned by dapp-kit). So decryption lives
// in a small standalone service (its own deps); this route is a thin proxy.
//
// Two phases (stateless): `challenge` mints a session-key for the buyer; the
// browser signs its personal message; `decrypt` completes the key, runs the
// on-chain seal_approve gate via the key servers, and returns the lessons.
import { NextRequest, NextResponse } from 'next/server';

const SEAL_SERVICE = process.env.SEAL_SERVICE_URL; // e.g. https://yosuku-seal.vercel.app

export async function POST(req: NextRequest) {
  if (!SEAL_SERVICE) {
    return NextResponse.json(
      { error: 'Decryption service not configured. Access is confirmed on-chain; the reveal is connecting.' },
      { status: 503 },
    );
  }
  try {
    const body = await req.json();
    const res = await fetch(`${SEAL_SERVICE}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 502 });
  }
}

// Bridge between the browser and the CCTP keeper on the box.
//
// The keeper listens on a Tailscale address the user's browser cannot reach, and should stay that
// way. So the browser talks to us and we talk to the box, exactly like the private-bet executor.
// Doing it the other way (a NEXT_PUBLIC keeper URL called from the client) would both fail for
// every real visitor and put the relayer's endpoint on the public internet.
//
// GET  → is the rail configured and up (the deposit card hides itself when it is not)
// GET  ?domain=&tx= → status of one deposit
// POST → hand a freshly broadcast burn to the keeper
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const KEEPER = process.env.CCTP_KEEPER_URL?.replace(/\/$/, '') ?? '';
const SECRET = process.env.CCTP_SHARED_SECRET ?? '';

const auth = (): Record<string, string> => (SECRET ? { 'x-cctp-auth': SECRET } : {});

export async function GET(req: Request) {
  if (!KEEPER) return NextResponse.json({ configured: false }, { status: 200 });

  const { searchParams } = new URL(req.url);
  const domain = searchParams.get('domain');
  const tx = searchParams.get('tx');

  try {
    if (!domain || !tx) {
      const r = await fetch(`${KEEPER}/health`, { headers: auth(), cache: 'no-store', signal: AbortSignal.timeout(6000) });
      return NextResponse.json({ configured: r.ok });
    }
    // Validated here as well as in the keeper: this path interpolates into a URL, so it must never
    // carry anything but a domain number and a transaction hash.
    if (!/^\d{1,3}$/.test(domain) || !/^[0-9a-zA-Z]{1,90}$/.test(tx)) {
      return NextResponse.json({ status: 'unknown' }, { status: 400 });
    }
    const r = await fetch(`${KEEPER}/deposit/${domain}/${tx}`, { headers: auth(), cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    // A keeper blip must not read as "your deposit failed". Unknown means keep polling.
    return NextResponse.json({ status: 'unknown' }, { status: 200 });
  }
}

export async function POST(req: Request) {
  if (!KEEPER) return NextResponse.json({ error: 'cross-chain deposits are not configured' }, { status: 503 });
  try {
    const { sourceDomain, txHash, user } = await req.json();
    if (!Number.isInteger(Number(sourceDomain)) || !/^0x[0-9a-fA-F]{64}$/.test(String(txHash ?? ''))) {
      return NextResponse.json({ error: 'need { sourceDomain, txHash }' }, { status: 400 });
    }
    const r = await fetch(`${KEEPER}/deposit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify({ sourceDomain: Number(sourceDomain), txHash, user }),
      signal: AbortSignal.timeout(10000),
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (e) {
    // The burn already happened on the source chain, so this failing is recoverable, not fatal:
    // the client retries, and the money is not lost either way because anyone can relay it.
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e).slice(0, 160) }, { status: 502 });
  }
}

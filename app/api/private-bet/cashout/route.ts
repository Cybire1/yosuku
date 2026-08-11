import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cashing out presents the enclave's signed claim, nothing more.
//
// The old shape took `owner` plus every bet parameter from the caller, which meant this proxy
// forwarded an attacker-chosen owner upstream with the server's own Bearer token attached. Now
// the owner and the parameters live INSIDE the signed bytes, so there is nothing here worth
// lying about: a forged or edited claim fails the signature check at the desk.
type PrivateCashoutRequest = {
  vortexPool?: unknown;
  ticketHex?: unknown;
  signatureHex?: unknown;
};

const EXECUTOR_URL = process.env.PRIVATE_BET_EXECUTOR_URL?.replace(/\/$/, '') ?? '';
const SHARED_SECRET = process.env.PRIVATE_BET_SHARED_SECRET ?? '';

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} required`);
  return value.trim();
}

function asHex(value: unknown, field: string, bytes: number): string {
  const v = asNonEmptyString(value, field).replace(/^0x/, '');
  if (!/^[a-fA-F0-9]+$/.test(v)) throw new Error(`${field} must be hex`);
  if (v.length !== bytes * 2) throw new Error(`${field} must be ${bytes} bytes`);
  return v;
}

function validate(body: PrivateCashoutRequest) {
  return {
    vortexPool: asNonEmptyString(body.vortexPool, 'vortexPool'),
    // 146 = the BCS ticket layout; 64 = ed25519. Pinning the lengths here means a malformed
    // claim is refused at the edge instead of travelling upstream to be parsed.
    ticketHex: asHex(body.ticketHex, 'ticketHex', 146),
    signatureHex: asHex(body.signatureHex, 'signatureHex', 64),
  };
}

export async function POST(req: Request) {
  try {
    const payload = validate((await req.json()) as PrivateCashoutRequest);

    if (!EXECUTOR_URL) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Private cashout is wired but no private bet executor is configured. Set PRIVATE_BET_EXECUTOR_URL on the Yosuku backend.',
          requiredExecutorContract: {
            method: 'POST',
            path: '/cashout',
            response: '{ digest: string, payoutDusdc?: number, creditedAt?: number }',
          },
        },
        { status: 501 },
      );
    }

    const upstream = await fetch(`${EXECUTOR_URL}/cashout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(SHARED_SECRET ? { authorization: `Bearer ${SHARED_SECRET}` } : {}),
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });

    const json = await upstream.json().catch(() => ({}));
    return NextResponse.json(json, { status: upstream.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

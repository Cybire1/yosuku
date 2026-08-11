import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Withdrawing presents enclave-signed claims, same rule as cashout. The old shape took `owner`
// and a list of digests from the caller, which meant guessing a digest was enough to drain
// somebody else's credited balance to your own address.
type PrivateWithdrawRequest = {
  vortexPool?: unknown;
  mode?: unknown;
  claims?: unknown;
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

function validate(body: PrivateWithdrawRequest) {
  const vortexPool = asNonEmptyString(body.vortexPool, 'vortexPool');
  const mode = body.mode === 'private' ? 'private' : 'fast';
  const raw = Array.isArray(body.claims) ? body.claims : [];
  if (raw.length === 0) throw new Error('claims required');

  const claims = raw.map((c, i) => ({
    ticketHex: asHex((c as { ticketHex?: unknown })?.ticketHex, `claims[${i}].ticketHex`, 146),
    signatureHex: asHex((c as { signatureHex?: unknown })?.signatureHex, `claims[${i}].signatureHex`, 64),
  }));

  return { vortexPool, mode, claims };
}

export async function POST(req: Request) {
  try {
    const payload = validate((await req.json()) as PrivateWithdrawRequest);

    if (!EXECUTOR_URL) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Private balance withdraw is wired but no private bet executor is configured. Set PRIVATE_BET_EXECUTOR_URL on the Yosuku backend.',
          requiredExecutorContract: {
            method: 'POST',
            path: '/withdraw',
            response: '{ digest: string, payoutDusdc?: number, ticketDigests?: string[], mode?: "fast" | "private" }',
          },
        },
        { status: 501 },
      );
    }

    const upstream = await fetch(`${EXECUTOR_URL}/withdraw`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(SHARED_SECRET ? { authorization: `Bearer ${SHARED_SECRET}` } : {}),
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
    });

    const json = await upstream.json().catch(() => ({}));
    return NextResponse.json(json, { status: upstream.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PrivateWithdrawRequest = {
  owner?: unknown;
  vortexPool?: unknown;
  mode?: unknown;
  ticketDigests?: unknown;
};

const EXECUTOR_URL = process.env.PRIVATE_BET_EXECUTOR_URL?.replace(/\/$/, '') ?? '';
const SHARED_SECRET = process.env.PRIVATE_BET_SHARED_SECRET ?? '';

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} required`);
  return value.trim();
}

function validate(body: PrivateWithdrawRequest) {
  const owner = asNonEmptyString(body.owner, 'owner');
  const vortexPool = asNonEmptyString(body.vortexPool, 'vortexPool');
  const mode = body.mode === 'private' ? 'private' : 'fast';
  const ticketDigests = Array.isArray(body.ticketDigests)
    ? body.ticketDigests.filter((digest): digest is string => typeof digest === 'string' && digest.length > 0)
    : [];

  if (!/^0x[a-fA-F0-9]+$/.test(owner)) throw new Error('owner must be a Sui address');
  if (ticketDigests.length === 0) throw new Error('ticketDigests required');

  return { owner, vortexPool, mode, ticketDigests };
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

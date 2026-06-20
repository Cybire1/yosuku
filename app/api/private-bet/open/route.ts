import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PrivateBetOpenRequest = {
  owner?: unknown;
  vortexPool?: unknown;
  oracleId?: unknown;
  expiry?: unknown;
  strike?: unknown;
  isUp?: unknown;
  stakeMicro?: unknown;
  quantity?: unknown;
  maxCostDusdc?: unknown;
};

const EXECUTOR_URL = process.env.PRIVATE_BET_EXECUTOR_URL?.replace(/\/$/, '') ?? '';
const SHARED_SECRET = process.env.PRIVATE_BET_SHARED_SECRET ?? '';

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} required`);
  return value.trim();
}

function asPositiveNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} must be positive`);
  return n;
}

function validate(body: PrivateBetOpenRequest) {
  const owner = asNonEmptyString(body.owner, 'owner');
  const vortexPool = asNonEmptyString(body.vortexPool, 'vortexPool');
  const oracleId = asNonEmptyString(body.oracleId, 'oracleId');
  const expiry = asNonEmptyString(body.expiry, 'expiry');
  const strike = asNonEmptyString(body.strike, 'strike');
  const stakeMicro = asNonEmptyString(body.stakeMicro, 'stakeMicro');
  const quantity = asNonEmptyString(body.quantity, 'quantity');
  const maxCostDusdc = asPositiveNumber(body.maxCostDusdc, 'maxCostDusdc');

  if (!/^0x[a-fA-F0-9]+$/.test(owner)) throw new Error('owner must be a Sui address');
  if (typeof body.isUp !== 'boolean') throw new Error('isUp must be boolean');
  if (!/^\d+$/.test(expiry)) throw new Error('expiry must be an integer string');
  if (!/^\d+$/.test(strike)) throw new Error('strike must be an integer string');
  if (!/^\d+$/.test(stakeMicro)) throw new Error('stakeMicro must be an integer string');
  if (!/^\d+$/.test(quantity)) throw new Error('quantity must be an integer string');

  return { owner, vortexPool, oracleId, expiry, strike, isUp: body.isUp, stakeMicro, quantity, maxCostDusdc };
}

export async function POST(req: Request) {
  try {
    const payload = validate((await req.json()) as PrivateBetOpenRequest);

    if (!EXECUTOR_URL) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Private betting is wired but no private bet executor is configured. Set PRIVATE_BET_EXECUTOR_URL on the Yosuku backend.',
          requiredExecutorContract: {
            method: 'POST',
            path: '/open',
            response:
              '{ digest: string, costDusdc?: number, sessionAddress?: string, sessionManager?: string, entryDigest?: string, returnDigest?: string }',
          },
        },
        { status: 501 },
      );
    }

    const upstream = await fetch(`${EXECUTOR_URL}/open`, {
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

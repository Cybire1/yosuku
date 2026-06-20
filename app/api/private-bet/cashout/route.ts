import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PrivateCashoutRequest = {
  owner?: unknown;
  vortexPool?: unknown;
  ticket?: {
    digest?: unknown;
    sessionAddress?: unknown;
    sessionManager?: unknown;
    oracleId?: unknown;
    expiry?: unknown;
    strike?: unknown;
    isUp?: unknown;
    stakeMicro?: unknown;
    quantity?: unknown;
  };
};

const EXECUTOR_URL = process.env.PRIVATE_BET_EXECUTOR_URL?.replace(/\/$/, '') ?? '';
const SHARED_SECRET = process.env.PRIVATE_BET_SHARED_SECRET ?? '';

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} required`);
  return value.trim();
}

function validate(body: PrivateCashoutRequest) {
  const ticket = body.ticket;
  if (!ticket || typeof ticket !== 'object') throw new Error('ticket required');

  const owner = asNonEmptyString(body.owner, 'owner');
  const vortexPool = asNonEmptyString(body.vortexPool, 'vortexPool');
  const digest = asNonEmptyString(ticket.digest, 'ticket.digest');
  const oracleId = asNonEmptyString(ticket.oracleId, 'ticket.oracleId');
  const expiry = asNonEmptyString(ticket.expiry, 'ticket.expiry');
  const strike = asNonEmptyString(ticket.strike, 'ticket.strike');
  const stakeMicro = asNonEmptyString(ticket.stakeMicro, 'ticket.stakeMicro');
  const quantity = asNonEmptyString(ticket.quantity, 'ticket.quantity');

  if (!/^0x[a-fA-F0-9]+$/.test(owner)) throw new Error('owner must be a Sui address');
  if (typeof ticket.isUp !== 'boolean') throw new Error('ticket.isUp must be boolean');
  if (!/^\d+$/.test(expiry)) throw new Error('ticket.expiry must be an integer string');
  if (!/^\d+$/.test(strike)) throw new Error('ticket.strike must be an integer string');
  if (!/^\d+$/.test(stakeMicro)) throw new Error('ticket.stakeMicro must be an integer string');
  if (!/^\d+$/.test(quantity)) throw new Error('ticket.quantity must be an integer string');

  return {
    owner,
    vortexPool,
    ticket: {
      digest,
      sessionAddress:
        typeof ticket.sessionAddress === 'string' && ticket.sessionAddress ? ticket.sessionAddress : undefined,
      sessionManager:
        typeof ticket.sessionManager === 'string' && ticket.sessionManager ? ticket.sessionManager : undefined,
      oracleId,
      expiry,
      strike,
      isUp: ticket.isUp,
      stakeMicro,
      quantity,
    },
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

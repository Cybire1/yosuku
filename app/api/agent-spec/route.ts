import { NextResponse } from 'next/server';

// The attested keeper needs to know WHAT a creator's agent trades (its preset + knobs).
// The on-chain listing already pins the hard caps + the agent = the sealed enclave address;
// this registers the *direction logic* the enclave will evaluate. It forwards to the spec
// registry that lives beside the keeper on the box (same shape as the private-bet executor:
// exposed endpoint + shared secret), so specs never touch a third party.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AgentSpecRequest = {
  strategyId?: unknown;
  agent?: unknown;
  creator?: unknown;
  spec?: { preset?: unknown; lookback?: unknown; thresholdBps?: unknown };
};

const REGISTRY_URL = process.env.AGENT_SPEC_REGISTRY_URL?.replace(/\/$/, '') ?? '';
const SHARED_SECRET = process.env.AGENT_SPEC_SHARED_SECRET ?? '';

function asAddress(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error(`${field} must be a 0x… address`);
  return value;
}
function asInt(value: unknown, field: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${field} must be an integer in [${min}, ${max}]`);
  return n;
}

function validate(body: AgentSpecRequest) {
  const strategyId = asAddress(body.strategyId, 'strategyId');
  const agent = asAddress(body.agent, 'agent');
  const creator = asAddress(body.creator, 'creator');
  const preset = body.spec?.preset;
  if (preset !== 'momentum' && preset !== 'reversion') throw new Error('spec.preset must be momentum | reversion');
  const lookback = asInt(body.spec?.lookback, 'spec.lookback', 2, 12);
  const thresholdBps = asInt(body.spec?.thresholdBps, 'spec.thresholdBps', 0, 4000);
  return { strategyId, agent, creator, spec: { preset, lookback, thresholdBps } };
}

export async function POST(req: Request) {
  try {
    const payload = validate((await req.json()) as AgentSpecRequest);

    if (!REGISTRY_URL) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Attested strategies are wired but no spec registry is configured. Set AGENT_SPEC_REGISTRY_URL on the Yosuku backend.',
          requiredRegistryContract: {
            method: 'POST',
            path: '/spec',
            body: '{ strategyId, agent, creator, spec: { preset, lookback, thresholdBps } }',
            response: '{ ok: boolean }',
          },
        },
        { status: 501 },
      );
    }

    const upstream = await fetch(`${REGISTRY_URL}/spec`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(SHARED_SECRET ? { authorization: `Bearer ${SHARED_SECRET}` } : {}),
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });

    const json = await upstream.json().catch(() => ({}));
    return NextResponse.json(json, { status: upstream.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

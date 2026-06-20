import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const reasons: string[] = [];
  const vortexPool = process.env.PRIVATE_BET_DUSDC_POOL || process.env.NEXT_PUBLIC_VORTEX_DUSDC_POOL || '0x0';
  const executorUrl = process.env.PRIVATE_BET_EXECUTOR_URL?.replace(/\/$/, '') ?? '';

  if (!executorUrl) reasons.push('Private bet executor is not configured.');

  let executorHealth: Record<string, unknown> | null = null;
  if (executorUrl) {
    try {
      const upstream = await fetch(`${executorUrl}/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      });
      executorHealth = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
      if (!upstream.ok) {
        reasons.push(`Private bet executor health failed: ${upstream.status}`);
      } else if (executorHealth.ready !== true) {
        const healthReasons = Array.isArray(executorHealth.reasons)
          ? executorHealth.reasons.filter((reason): reason is string => typeof reason === 'string')
          : [];
        reasons.push(...(healthReasons.length ? healthReasons : ['Private bet executor is not ready.']));
      }
    } catch (error) {
      reasons.push(error instanceof Error ? `Private bet executor offline: ${error.message}` : 'Private bet executor offline.');
    }
  }

  return NextResponse.json({
    ready: reasons.length === 0,
    label: reasons.length === 0 ? 'READY' : 'BETA',
    reasons,
    vortexPool: typeof executorHealth?.vortexPool === 'string' ? executorHealth.vortexPool : vortexPool,
    mode: typeof executorHealth?.mode === 'string' ? executorHealth.mode : 'unconfigured',
    sessionAddress: typeof executorHealth?.sessionAddress === 'string' ? executorHealth.sessionAddress : '',
    maxStakeDusdc: typeof executorHealth?.maxStakeDusdc === 'number' ? executorHealth.maxStakeDusdc : null,
    privateBalanceEnabled: executorHealth?.privateBalanceEnabled === true,
    withdrawModes: Array.isArray(executorHealth?.withdrawModes)
      ? executorHealth.withdrawModes.filter((mode): mode is 'fast' | 'private' => mode === 'fast' || mode === 'private')
      : [],
  });
}

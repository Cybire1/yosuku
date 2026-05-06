// @ts-nocheck
'use client';

import { ArrowUpRight, EyeOff, Lock, Radar, Waves } from 'lucide-react';
import { impliedProb, formatMultiplier, type RoundState } from '@/lib/predictionContract';
import type { PolymarketData } from './PolymarketCard';

interface PublicPrivateSignalProps {
  round: RoundState;
  market: PolymarketData | null;
  loading?: boolean;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export default function PublicPrivateSignal({
  round,
  market,
  loading = false,
}: PublicPrivateSignalProps) {
  const privateYes = clampPercent(impliedProb(round.yesMult));
  const privateNo = 100 - privateYes;

  const publicYes = market ? clampPercent(Math.round(parseFloat(market.outcomePrices[0]) * 100)) : null;
  const publicNo = publicYes === null ? null : 100 - publicYes;
  const divergence = publicYes === null ? null : Math.abs(privateYes - publicYes);
  const lead =
    publicYes === null
      ? null
      : privateYes > publicYes
        ? 'DART is more bullish'
        : privateYes < publicYes
          ? 'Polymarket is more bullish'
          : 'Consensus is aligned';

  return (
    <section className="mb-6 rounded-3xl border border-white/8 bg-gradient-to-br from-white/[0.035] via-white/[0.02] to-transparent p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="flex-1 rounded-2xl border border-white/7 bg-black/35 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-sky-300">
              <Radar className="h-3 w-3" />
              Public vs DART
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-new-mint/20 bg-new-mint/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-new-mint">
              <Lock className="h-3 w-3" />
              Live sentiment spread
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/6 bg-black/35 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Public Consensus</p>
                  <p className="mt-1 text-sm font-semibold text-white">Polymarket benchmark</p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-sky-400" />
              </div>
              {loading ? (
                <p className="text-sm text-gray-500">Loading public market signal...</p>
              ) : market && publicYes !== null && publicNo !== null ? (
                <>
                  <p className="mb-3 text-sm text-gray-400 line-clamp-2">{market.question}</p>
                  <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
                    <span className="text-new-mint">Yes {publicYes}%</span>
                    <span className="text-off-red">No {publicNo}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/6">
                    <div
                      className="h-full bg-gradient-to-r from-new-mint to-sky-400"
                      style={{ width: `${publicYes}%` }}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500">No live Polymarket BTC benchmark available right now.</p>
              )}
            </div>

            <div className="rounded-2xl border border-white/6 bg-black/35 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">DART Consensus</p>
                  <p className="mt-1 text-sm font-semibold text-white">DART locked odds</p>
                </div>
                <EyeOff className="h-4 w-4 text-new-mint" />
              </div>
              <p className="mb-3 text-sm text-gray-400">
                Round #{round.id} on-chain. YES {formatMultiplier(round.yesMult)} / NO {formatMultiplier(round.noMult)}.
              </p>
              <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
                <span className="text-new-mint">Yes {privateYes}%</span>
                <span className="text-off-red">No {privateNo}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/6">
                <div
                  className="h-full bg-gradient-to-r from-new-mint to-new-mint/60"
                  style={{ width: `${privateYes}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="w-full rounded-2xl border border-white/7 bg-black/35 p-4 lg:max-w-[280px]">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
            <Waves className="h-3 w-3" />
            Divergence
          </p>

          {divergence === null ? (
            <p className="text-sm text-gray-500">Waiting for a public BTC market benchmark.</p>
          ) : (
            <>
              <div className="mb-3 text-4xl font-black tracking-tight text-white">
                {divergence}%
              </div>
              <p className="mb-4 text-sm text-gray-400">{lead}</p>
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Why it matters</p>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">
                  Polymarket shows public order flow. DART shows conviction expressed on-chain on Sui.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { ArrowRight } from 'lucide-react';
import type { OracleData } from '@/lib/sui/predictApi';
import type { RoundState } from '@/lib/predictionContract';
import { loadPositions, isPositionClaimed, getTimeRemaining, formatCountdown, type LocalPosition } from '@/lib/roundHelpers';
import { recordPnl } from '@/lib/dailyStop';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import ClaimWinnings from './ClaimWinnings';

/**
 * The settled market answered personally. "UP wins" is the market's outcome;
 * the first thing a position-holder should see is THEIR outcome — then a
 * one-tap path into the next round — the loop of fast rounds, one close into the next.
 */
interface VerdictProps {
  oracle: OracleData;
}

export default function Verdict({ oracle }: VerdictProps) {
  const router = useRouter();
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [positions, setPositions] = useState<LocalPosition[]>([]);
  const [nextRound, setNextRound] = useState<{ id: string; expiry: number } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!address) return;
    setPositions(loadPositions().filter(p => p.oracleId === oracle.oracle_id));
  }, [address, oracle.oracle_id]);

  // Find the soonest active round for the same asset
  useEffect(() => {
    let cancelled = false;
    async function findNext() {
      try {
        const res = await fetch('/api/oracles');
        if (!res.ok) return;
        const all = (await res.json()) as { oracle_id: string; status: string; expiry: number; underlying_asset?: string }[];
        const next = all
          .filter(o =>
            o.status === 'active' &&
            o.expiry > Date.now() &&
            (o.underlying_asset || 'BTC') === (oracle.underlying_asset || 'BTC') &&
            o.oracle_id !== oracle.oracle_id,
          )
          .sort((a, b) => a.expiry - b.expiry)[0];
        if (!cancelled && next) setNextRound({ id: next.oracle_id, expiry: next.expiry });
      } catch { /* ignore */ }
    }
    findNext();
    const iv = setInterval(findNext, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [oracle.oracle_id, oracle.underlying_asset]);

  // tick the next-round countdown
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const settlement = oracle.settlement_price;
  if (settlement === null || settlement === undefined) return null;

  const round = {
    id: oracle.oracle_id,
    oracleId: oracle.oracle_id,
    underlyingAsset: oracle.underlying_asset || 'BTC',
    expiry: oracle.expiry,
    minStrike: oracle.min_strike,
    tickSize: oracle.tick_size,
    status: oracle.status,
    settlementPrice: settlement,
    resolved: true,
    endTime: oracle.expiry,
  } as unknown as RoundState;

  const fmt = (scaled: number) =>
    '$' + (scaled / FLOAT_SCALING).toLocaleString(undefined, { maximumFractionDigits: 0 });

  const claimed = isPositionClaimed(oracle.oracle_id);


  return (
    <div className="space-y-3 mb-8">
      {/* Non-holders still see what the market did. */}
      {positions.length === 0 && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.015] p-5">
          <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-gray-500 mb-1.5">
            {oracle.underlying_asset || 'BTC'} settled
          </div>
          <p className="text-sm text-gray-300">
            Closed at <span className="text-white font-mono">{fmt(settlement)}</span> — this round is decided.
          </p>
        </div>
      )}

      {/* One premium result card per position (outcome + payout + claim). */}
      {positions.map(p => {
        const won = p.direction === 'UP' ? settlement > p.strike : settlement <= p.strike;
        return (
          <ClaimWinnings
            key={p.timestamp}
            round={round}
            userDeposit={p.quantity}
            userDirection={p.direction}
            strike={p.strike}
            onClaimed={() => recordPnl((won ? p.quantity : 0) / DUSDC_MULTIPLIER - p.cost / DUSDC_MULTIPLIER)}
          />
        );
      })}

      {/* The loop: a clear CTA straight into the next LIVE round */}
      {nextRound ? (
        <button
          onClick={() => router.push(`/markets/${nextRound.id}`)}
          data-cursor="hover"
          className="w-full flex items-center justify-between gap-3 p-4 rounded-xl border border-vermilion/40 bg-vermilion/[0.10] hover:bg-vermilion/20 hover:border-vermilion/60 transition-all group"
        >
          <span className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-vermilion opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-vermilion" />
            </span>
            <span className="text-sm font-bold text-white">
              Trade the live {oracle.underlying_asset || 'BTC'} market
            </span>
          </span>
          <span className="flex items-center gap-2 font-mono text-xs text-vermilion">
            closes in {formatCountdown(getTimeRemaining(nextRound.expiry))}
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </button>
      ) : (
        <button
          onClick={() => router.push('/markets')}
          data-cursor="hover"
          className="w-full flex items-center justify-between gap-3 p-4 rounded-xl border border-vermilion/40 bg-vermilion/[0.10] hover:bg-vermilion/20 hover:border-vermilion/60 transition-all group"
        >
          <span className="text-sm font-bold text-white">Browse live markets</span>
          <ArrowRight className="w-4 h-4 text-vermilion group-hover:translate-x-0.5 transition-transform" />
        </button>
      )}
    </div>
  );
}

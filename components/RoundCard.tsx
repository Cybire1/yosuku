'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { formatPred, estimateProb, type RoundState } from '@/lib/predictionContract';
import LiveBtcChart from './charts/LiveBtcChart';

interface RoundCardProps {
  round: RoundState;
  userYesDeposit?: number;
  userNoDeposit?: number;
}

export default function RoundCard({
  round,
  userYesDeposit = 0,
  userNoDeposit = 0,
}: RoundCardProps) {
  const { price, connected } = useBtcPrice();
  const [mins, setMins] = useState(0);
  const [secs, setSecs] = useState(0);
  const [progress, setProgress] = useState(100);

  const totalPool = round.yesPool + round.noPool;
  const targetUsd = round.targetPrice / 100;
  const priceDelta = price > 0 ? price - targetUsd : 0;
  const isAbove = price >= targetUsd;

  // Countdown timer using round.endTime
  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, round.endTime - Date.now());
      const totalSecs = Math.floor(remaining / 1000);
      setMins(Math.floor(totalSecs / 60));
      setSecs(totalSecs % 60);
      setProgress((remaining / round.durationMs) * 100);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [round.id, round.endTime, round.durationMs]);

  // Calculate estimated payout for user
  const calcEstPayout = (deposit: number, side: 'yes' | 'no') => {
    const winPool = side === 'yes' ? round.yesPool : round.noPool;
    if (winPool === 0 || deposit === 0) return 0;
    return (deposit / winPool) * totalPool * 0.9;
  };

  const userSide = userYesDeposit > 0 ? 'YES' : userNoDeposit > 0 ? 'NO' : null;
  const userDeposit = userYesDeposit || userNoDeposit;
  const estPayout = userSide === 'YES'
    ? calcEstPayout(userYesDeposit, 'yes')
    : calcEstPayout(userNoDeposit, 'no');

  return (
    <div className="relative">
      {/* Ambient glow */}
      <div className="absolute -inset-1 bg-gradient-to-r from-new-mint/20 via-new-blue/10 to-new-mint/20 rounded-3xl blur-xl opacity-50" />

      <div className="relative bg-neutral-900/80 backdrop-blur-2xl border border-white/10 rounded-3xl overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-white/5">
          <motion.div
            className="h-full bg-gradient-to-r from-new-mint to-new-blue"
            style={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        <div className="p-6 md:p-8">
          {/* Top row: Price to Beat | Current Price | Countdown */}
          <div className="flex items-start justify-between mb-6">
            {/* Price to Beat */}
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
                Price to Beat
              </span>
              <span className="text-xl md:text-2xl font-mono font-bold text-gray-400">
                ${targetUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>

            {/* Current Price + delta */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-new-mint animate-pulse' : 'bg-red-500'}`} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  Current Price
                </span>
                {price > 0 && (
                  <span className={`text-[10px] font-mono font-bold ${isAbove ? 'text-new-mint' : 'text-off-red'}`}>
                    {isAbove ? '+' : ''}{priceDelta.toFixed(2)}
                  </span>
                )}
              </div>
              <span className={`text-xl md:text-2xl font-mono font-black ${isAbove ? 'text-new-mint' : 'text-off-red'}`}>
                ${price > 0 ? price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '---'}
              </span>
            </div>

            {/* Countdown — Polymarket style */}
            <div className="text-right">
              <div className="flex items-center gap-2 justify-end mb-1">
                <Clock className="w-3 h-3 text-gray-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  Round #{round.id}
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-mono font-black text-white">{String(mins).padStart(2, '0')}</span>
                <span className="text-[10px] font-bold text-gray-500 uppercase mr-2">mins</span>
                <span className="text-3xl font-mono font-black text-white">{String(secs).padStart(2, '0')}</span>
                <span className="text-[10px] font-bold text-gray-500 uppercase">secs</span>
              </div>
            </div>
          </div>

          {/* Probability bar */}
          {price > 0 && mins + secs > 0 && (
            <div className="mb-4">
              {(() => {
                const prob = estimateProb(price, targetUsd, mins + secs / 60);
                const yesPct = Math.round(prob * 100);
                const noPct = 100 - yesPct;
                return (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-new-mint w-10 text-right">{yesPct}%</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden flex bg-white/5">
                      <div
                        className="h-full bg-gradient-to-r from-new-mint to-new-mint/60 transition-all duration-700"
                        style={{ width: `${yesPct}%` }}
                      />
                      <div
                        className="h-full bg-gradient-to-l from-off-red to-off-red/60 transition-all duration-700"
                        style={{ width: `${noPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-off-red w-10">{noPct}%</span>
                  </div>
                );
              })()}
              <div className="text-center mt-1">
                <span className="text-[9px] uppercase tracking-widest text-gray-600">Probability Estimate</span>
              </div>
            </div>
          )}

          {/* Live BTC Chart */}
          <div className="mb-6 bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden">
            <LiveBtcChart targetPrice={round.targetPrice} height={370} />
          </div>

          {/* Pool info bar */}
          <div className="mb-4 flex items-center gap-4 px-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Pool</span>
              <span className="text-sm font-mono font-bold text-new-mint">{formatPred(totalPool)} DART</span>
            </div>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-new-mint to-new-mint/60 rounded-full transition-all duration-500"
                style={{ width: `${totalPool > 0 ? (round.yesPool / totalPool) * 100 : 50}%` }}
              />
            </div>
            <div className="flex items-center gap-3 text-[10px] font-bold">
              <span className="text-new-mint">YES {formatPred(round.yesPool)}</span>
              <span className="text-off-red">NO {formatPred(round.noPool)}</span>
            </div>
          </div>

          {/* User position */}
          {userSide && (
            <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Your Position</span>
                  <span className={`text-sm font-bold ${userSide === 'YES' ? 'text-new-mint' : 'text-off-red'}`}>
                    {formatPred(userDeposit)} DART on {userSide}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Est. Payout</span>
                  <span className="text-sm font-mono font-bold text-white">
                    {formatPred(estPayout)} DART
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

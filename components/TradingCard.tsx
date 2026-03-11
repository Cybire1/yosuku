'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import {
  formatPred,
  estimateProb,
  type RoundState,
} from '@/lib/predictionContract';
import LiveBtcChart from './charts/LiveBtcChart';
import BitcoinIcon from './icons/BitcoinIcon';
import PriceTicker from './PriceTicker';
import AnimatedNumber from './AnimatedNumber';

interface TradingCardProps {
  round: RoundState;
  userYesDeposit?: number;
  userNoDeposit?: number;
  lockedPayout?: number;
}

export default function TradingCard({
  round,
  userYesDeposit = 0,
  userNoDeposit = 0,
  lockedPayout = 0,
}: TradingCardProps) {
  const { price, connected } = useBtcPrice();

  const [mins, setMins] = useState(0);
  const [secs, setSecs] = useState(0);
  const [progress, setProgress] = useState(100);

  const totalPool = round.totalPool;
  const targetUsd = round.targetPrice / 100;
  const priceDelta = price > 0 ? price - targetUsd : 0;
  const isAbove = price >= targetUsd;
  const minsLeft = mins + secs / 60;

  // Countdown timer
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

  // User position calculations
  const userSide = userYesDeposit > 0 ? 'YES' : userNoDeposit > 0 ? 'NO' : null;
  const userDeposit = userYesDeposit || userNoDeposit;
  const totalExposure = round.yesPool + round.noPool;
  const positionPayout = (() => {
    if (!userSide) return 0;
    if (lockedPayout > 0) return lockedPayout;

    // During dark pool: use probability-based estimate
    if (price > 0 && minsLeft > 0) {
      const prob = estimateProb(price, targetUsd, minsLeft);
      const sideProb = userSide === 'YES' ? prob : 1 - prob;
      if (sideProb > 0) {
        return userDeposit / sideProb;
      }
    }

    // Fallback: assume 50/50
    return userDeposit * 2;
  })();

  return (
    <div className="relative">
      {/* Ambient glow */}
      <div className="absolute -inset-1 bg-gradient-to-r from-new-mint/20 via-new-blue/10 to-new-mint/20 rounded-3xl blur-xl opacity-50" />

      <div className="relative bg-black/90 backdrop-blur-2xl border border-white/10 rounded-3xl overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-white/5">
          <motion.div
            className="h-full bg-gradient-to-r from-new-mint to-new-blue"
            style={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        <div className="p-5 md:p-7">
          {/* Header: Round ID + Countdown */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-widest text-gray-400">Round</span>
              <span className="text-lg font-mono font-black text-gray-300">#{round.id}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-gray-500" />
              {mins === 0 && secs === 0 ? (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500/60 animate-pulse" />
                  <span className="text-sm font-bold text-amber-500/70">Resolving on-chain...</span>
                </div>
              ) : (
                <>
                  <span className="text-xl sm:text-2xl font-mono font-black text-gray-300">
                    {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
                  </span>
                  <span className="text-[10px] font-bold text-gray-500 uppercase">left</span>
                </>
              )}
            </div>
          </div>

          {/* Price row */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
                Price to Beat
              </span>
              <span className="text-base sm:text-xl font-mono font-bold text-gray-400">
                ${targetUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2 mb-1 justify-end">
                <BitcoinIcon className="w-4 h-4" />
                <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-new-mint animate-pulse' : 'bg-red-500'}`} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Live BTC</span>
              </div>
              <PriceTicker price={price} className={`text-base sm:text-xl font-mono font-black ${isAbove ? 'text-new-mint' : 'text-off-red'}`} />
              {price > 0 && (
                <span className={`block text-xs font-mono font-bold mt-0.5 ${isAbove ? 'text-new-mint/40' : 'text-off-red/40'}`}>
                  {isAbove ? '+' : ''}{priceDelta.toFixed(2)} {isAbove ? 'Above' : 'Below'} Target
                </span>
              )}
            </div>
          </div>

          {/* Live BTC Chart */}
          <div className="mb-5 bg-black/55 border border-white/5 rounded-2xl overflow-hidden">
            <div className="h-[220px] sm:h-[350px]">
              <LiveBtcChart targetPrice={round.targetPrice} />
            </div>
          </div>

          {/* Probability bar */}
          {price > 0 && minsLeft > 0 && (
            <div className="mb-5">
              {(() => {
                const prob = estimateProb(price, targetUsd, minsLeft);
                const yesPct = Math.round(prob * 100);
                const noPct = 100 - yesPct;
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-new-mint w-10 text-right">{yesPct}%</span>
                      <div className="flex-1 h-2.5 rounded-full overflow-hidden flex bg-white/5">
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
                    <div className="text-center mt-1">
                      <span className="text-[9px] uppercase tracking-widest text-gray-600">Probability</span>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Pool stats */}
          <div className="flex items-center gap-4 px-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Staked</span>
              <AnimatedNumber value={formatPred(totalPool)} className="text-sm font-mono font-bold text-new-mint" />
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">USDCx</span>
            </div>
            <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-new-mint to-new-mint/60 rounded-full transition-all duration-500"
                style={{ width: `${totalExposure > 0 ? (round.yesPool / totalExposure) * 100 : 50}%` }}
              />
            </div>
            <div className="flex items-center gap-3 text-[10px] font-bold">
              <div className="flex items-center gap-1 text-new-mint">
                <span>YES lock</span>
                <AnimatedNumber value={formatPred(round.yesPool)} />
              </div>
              <div className="flex items-center gap-1 text-off-red">
                <span>NO lock</span>
                <AnimatedNumber value={formatPred(round.noPool)} />
              </div>
            </div>
          </div>

          {/* User position */}
          {userSide && (
            <div className="mt-4 p-4 bg-black/45 border border-white/5 rounded-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Your Position</span>
                  <span className={`text-sm font-bold ${userSide === 'YES' ? 'text-new-mint' : 'text-off-red'}`}>
                    {formatPred(userDeposit)} USDCx on {userSide}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
                    {lockedPayout > 0 ? 'Locked Payout' : 'Live Est. Payout'}
                  </span>
                  <span className="text-sm font-mono font-bold text-white">
                    {formatPred(positionPayout)} USDCx
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-gray-600 mt-2">
                {lockedPayout > 0
                  ? 'Your fixed payout was locked when the bet executed on-chain.'
                  : 'Estimate shown only while your fixed-odds receipt is still syncing.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

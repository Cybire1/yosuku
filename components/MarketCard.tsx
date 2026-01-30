'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, TrendingUp, Users, ArrowUpRight } from 'lucide-react';
import { formatDistance } from 'date-fns';
import { useRouter } from 'next/navigation';
import BetModal from './BetModal';
import MiniPriceChart from './charts/MiniPriceChart';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface Market {
  id: number;
  question: string;
  image?: string; // Cinematic background image
  end_timestamp: number;
  total_yes_shares: number;
  total_no_shares: number;
  total_volume: number;
  resolved: boolean;
  outcome?: boolean;
  winning_side?: 'YES' | 'NO';
  category?: string;
  end_date?: number;
}

interface MarketCardProps {
  market: Market;
}

export default function MarketCard({ market }: MarketCardProps) {
  const router = useRouter();
  const [showBetModal, setShowBetModal] = useState(false);
  const [selectedSide, setSelectedSide] = useState<'YES' | 'NO'>('YES');

  // Calculate odds
  const total = market.total_yes_shares + market.total_no_shares || 1;
  const yesOdds = Math.round((market.total_yes_shares / total) * 100);
  const noOdds = 100 - yesOdds;

  // Time remaining
  const timeRemaining = formatDistance(market.end_timestamp * 1000, Date.now(), {
    addSuffix: true,
  });

  const handleBet = (side: 'YES' | 'NO') => {
    setSelectedSide(side);
    setShowBetModal(true);
  };

  const handleCardClick = () => {
    router.push(`/market/${market.id}`);
  };

  return (
    <>
      <motion.div
        whileHover={{ y: -4, scale: 1.005 }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={handleCardClick}
        className="relative group cursor-pointer block h-full min-h-[280px]"
      >
        {/* Hover Ambient Glow */}
        <div className="absolute -inset-0.5 bg-gradient-to-r from-new-mint/30 to-new-blue/30 rounded-2xl opacity-0 group-hover:opacity-100 blur-lg transition-all duration-500" />

        {/* Card Background */}
        <div className="relative h-full bg-neutral-900/60 backdrop-blur-xl border border-white/5 hover:border-white/10 transition-all duration-300 rounded-2xl overflow-hidden ring-1 ring-white/5 group-hover:ring-white/10 group-hover:shadow-2xl">

          {/* Cinematic Image Background */}
          {market.image && (
            <div className="absolute inset-y-0 right-0 w-[60%] z-0 pointer-events-none">
              <div className="absolute inset-0 bg-gradient-to-l from-transparent via-neutral-900/80 to-neutral-900 z-10" />
              <img
                src={market.image}
                alt=""
                className="w-full h-full object-cover opacity-40 group-hover:opacity-60 group-hover:scale-105 transition-all duration-700 contrast-125 saturate-0 group-hover:saturate-100"
              />
            </div>
          )}

          <div className="p-8 flex flex-col gap-6 h-full justify-between">

            {/* Top Section */}
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1">
                {/* Badges */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest bg-white/5 text-gray-400 rounded-lg border border-white/5">
                    {market.category || 'Crypto'}
                  </span>
                  {!market.resolved && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-red-400 bg-red-400/10 rounded-lg border border-red-400/10">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                      LIVE
                    </span>
                  )}
                </div>

                {/* Question */}
                <h3 className="text-xl md:text-2xl font-bold text-white leading-tight group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-gray-300 transition-all mb-3">
                  {market.question}
                </h3>

                {/* Metadata Row */}
                <div className="flex items-center gap-6 text-xs font-medium text-gray-500">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>{timeRemaining}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    <span>${Math.floor(market.total_volume / 1000)}k Vol</span>
                  </div>
                </div>
              </div>

              {/* Chart Decoration (Sparkline Placeholder) */}
              <div className="hidden sm:block w-24 h-12 opacity-30 grayscale group-hover:grayscale-0 group-hover:opacity-60 transition-all duration-500">
                <MiniPriceChart color={yesOdds >= 50 ? "#34D399" : "#F43F5E"} />
              </div>
            </div>

            {/* Bottom Section - Action Buttons */}
            <div className="grid grid-cols-2 gap-3 mt-2">
              {market.resolved ? (
                <div className="col-span-2 p-4 bg-white/5 rounded-xl border border-white/10 text-center">
                  <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Result</p>
                  <p className={`text-xl font-bold ${market.winning_side === 'YES' ? 'text-new-mint' : 'text-off-red'}`}>
                    {market.winning_side || (yesOdds > noOdds ? 'YES' : 'NO')}
                  </p>
                </div>
              ) : (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleBet('YES'); }}
                    className="relative group/btn flex flex-col items-center justify-center p-4 rounded-xl bg-new-mint/5 hover:bg-new-mint/10 border border-new-mint/20 hover:border-new-mint/40 transition-all overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-new-mint/10 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300" />
                    <span className="relative text-xs font-bold text-new-mint uppercase tracking-wider mb-1">Yes</span>
                    <span className="relative text-2xl font-black text-white">{yesOdds}%</span>
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); handleBet('NO'); }}
                    className="relative group/btn flex flex-col items-center justify-center p-4 rounded-xl bg-off-red/5 hover:bg-off-red/10 border border-off-red/20 hover:border-off-red/40 transition-all overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-off-red/10 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300" />
                    <span className="relative text-xs font-bold text-off-red uppercase tracking-wider mb-1">No</span>
                    <span className="relative text-2xl font-black text-white">{noOdds}%</span>
                  </button>
                </>
              )}
            </div>

          </div>
        </div>
      </motion.div>

      {/* Bet Modal */}
      {showBetModal && (
        <BetModal
          market={market}
          side={selectedSide}
          onClose={() => setShowBetModal(false)}
        />
      )}
    </>
  );
}

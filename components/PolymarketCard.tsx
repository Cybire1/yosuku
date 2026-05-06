'use client';

import { motion } from 'framer-motion';
import { ExternalLink, TrendingUp, Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';

export interface PolymarketData {
  id: string;
  question: string;
  description: string;
  endDate: string;
  category: string;
  volume: number;
  liquidity: number;
  image: string;
  icon: string;
  outcomePrices: [string, string]; // [YES price, NO price]
  outcomes: [string, string]; // ["Yes", "No"]
  slug: string;
  volume24hr?: number;
  hasLivePrice?: boolean; // True if using real-time CLOB data
}

interface PolymarketCardProps {
  market: PolymarketData;
  showCloneAction?: boolean;
}

export default function PolymarketCard({
  market,
  showCloneAction = false,
}: PolymarketCardProps) {
  const router = useRouter();

  // Calculate probability from price (0-1 range to percentage)
  const yesProb = (parseFloat(market.outcomePrices[0]) * 100).toFixed(0);
  const noProb = (parseFloat(market.outcomePrices[1]) * 100).toFixed(0);

  // Format volume
  const formatVolume = (vol: number) => {
    if (vol >= 1000000) return `$${(vol / 1000000).toFixed(1)}M`;
    if (vol >= 1000) return `$${(vol / 1000).toFixed(0)}K`;
    return `$${vol.toFixed(0)}`;
  };

  const handleCloneToSui = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Store market data in sessionStorage to pre-fill create form
    sessionStorage.setItem('cloneMarket', JSON.stringify({
      question: market.question,
      endDate: new Date(market.endDate).toISOString().split('T')[0],
    }));
    router.push('/create');
  };

  return (
    <motion.div
      whileHover={{ y: -5 }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative group cursor-pointer h-full min-h-[280px] md:min-h-[340px] flex flex-col"
      onClick={() => window.open(`https://polymarket.com/event/${market.slug}`, '_blank')}
    >
      {/* Card Background - Award Winning Liquid Glass */}
      <div className="absolute inset-0 bg-neutral-900/60 backdrop-blur-2xl border border-white/10 group-hover:border-off-blue/50 transition-all duration-500 rounded-2xl shadow-2xl group-hover:shadow-[0_0_40px_rgba(96,165,250,0.15)]" />
      <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />

      {/* Decorative Blur blob behind card */}
      <div className="absolute -inset-4 bg-new-mint/5 blur-[40px] -z-10 rounded-full mix-blend-screen opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      {/* Content Container */}
      <div className="relative p-4 md:p-6 flex flex-col h-full z-10">

        {/* Header: Category & Live Status */}
        <div className="flex justify-between items-start mb-4 md:mb-6">
          <div className="flex gap-2">
            <span className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest bg-off-blue/10 text-off-blue border border-off-blue/20 rounded-md flex items-center gap-1">
              <ExternalLink className="w-3 h-3" />
              Polymarket
            </span>
            {market.hasLivePrice && (
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-off-green bg-off-green/10 px-2 py-1 rounded-full border border-off-green/20">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-off-green opacity-40"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-off-green"></span>
                </span>
                Live
              </div>
            )}
          </div>
        </div>

        {/* Question */}
        <div className="mb-4 md:mb-8">
          <h3 className="text-lg md:text-xl font-bold text-white leading-tight group-hover:text-off-blue transition-colors duration-300 line-clamp-2">
            {market.question}
          </h3>
          <p className="text-gray-400 text-xs font-mono mt-2 flex items-center gap-2">
            <TrendingUp className="w-3 h-3" /> Vol: {formatVolume(market.volume)}
          </p>
        </div>

        {/* Action Area */}
        <div className="mt-auto relative h-14 bg-neutral-950 rounded-xl p-1.5 flex gap-1 border border-white/5 group/action">

          {/* YES Button (Green) */}
          <div className="flex-1 rounded-lg bg-off-green/10 border border-off-green/10 relative overflow-hidden flex items-center justify-between px-3">
            <div className="absolute inset-y-0 left-0 bg-off-green/10" style={{ width: `${yesProb}%` }} />
            <span className="relative z-10 text-[10px] font-bold uppercase tracking-wider text-off-green">Yes</span>
            <span className="relative z-10 text-sm font-mono font-bold text-white">{yesProb}%</span>
          </div>

          {/* NO Button (Red) */}
          <div className="flex-1 rounded-lg bg-off-red/10 border border-off-red/10 relative overflow-hidden flex items-center justify-between px-3">
            <div className="absolute inset-y-0 left-0 bg-off-red/10" style={{ width: `${noProb}%` }} />
            <span className="relative z-10 text-[10px] font-bold uppercase tracking-wider text-off-red">No</span>
            <span className="relative z-10 text-sm font-mono font-bold text-white">{noProb}%</span>
          </div>

          {showCloneAction && (
            <button
              onClick={handleCloneToSui}
              className="absolute inset-1 bg-white text-black font-bold uppercase tracking-widest text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center gap-2 hover:scale-[1.02] shadow-xl z-20"
            >
              <Copy className="w-4 h-4" />
              Clone to Sui
            </button>
          )}

        </div>

      </div>
    </motion.div>
  );
}

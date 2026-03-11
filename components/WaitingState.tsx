'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';
import LiveBtcChart from './charts/LiveBtcChart';
import BitcoinIcon from './icons/BitcoinIcon';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';

export default function WaitingState() {
  const { price, connected } = useBtcPrice();

  return (
    <div className="relative">
      <div className="absolute -inset-1 bg-gradient-to-r from-white/5 via-new-blue/5 to-white/5 rounded-3xl blur-xl opacity-50" />

      <div className="relative bg-black/90 backdrop-blur-2xl border border-white/10 rounded-3xl overflow-hidden">
        {/* Subtle progress bar placeholder */}
        <div className="h-1 bg-white/5" />

        <div className="p-5 md:p-7">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-widest text-gray-500">Waiting for Round</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-new-blue animate-pulse" />
              <span className="text-xs font-bold text-gray-500">Monitoring</span>
            </div>
          </div>

          {/* Live BTC price */}
          <div className="flex items-center gap-3 mb-5">
            <BitcoinIcon className="w-5 h-5" />
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-new-mint animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xl font-mono font-black text-white">
              ${price > 0 ? price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '---'}
            </span>
          </div>

          {/* Live chart without target line */}
          <div className="mb-5 bg-black/55 border border-white/5 rounded-2xl overflow-hidden">
            <LiveBtcChart height={280} />
          </div>

          {/* Disabled YES/NO buttons */}
          <div className="grid grid-cols-2 gap-2 mb-4 opacity-40 pointer-events-none">
            <div className="py-3 rounded-xl font-bold text-sm bg-black/45 text-gray-500 border-2 border-transparent text-center">
              <div className="flex items-center justify-center gap-2">
                <TrendingUp className="w-4 h-4" />
                <span>Yes</span>
                <span className="font-mono">—</span>
              </div>
            </div>
            <div className="py-3 rounded-xl font-bold text-sm bg-black/45 text-gray-500 border-2 border-transparent text-center">
              <div className="flex items-center justify-center gap-2">
                <TrendingDown className="w-4 h-4" />
                <span>No</span>
                <span className="font-mono">—</span>
              </div>
            </div>
          </div>

          {/* Message */}
          <div className="text-center py-4 px-6 bg-black/45 border border-white/5 rounded-2xl">
            <p className="text-sm text-gray-400 font-medium">
              Next round will appear when created on-chain
            </p>
            <p className="text-[10px] text-gray-600 mt-1 uppercase tracking-widest">
              Checking every 15 seconds
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

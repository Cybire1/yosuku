'use client';

import { motion } from 'framer-motion';
import { Flame, Target, Award, TrendingUp } from 'lucide-react';
import { type ReputationData } from '@/lib/predictionContract';
import ReputationBadge from './ReputationBadge';

interface ReputationCardProps {
  data: ReputationData;
}

export default function ReputationCard({ data }: ReputationCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-neutral-900/60 backdrop-blur-xl border border-white/5 rounded-2xl p-5 space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em]">
          Reputation
        </h3>
        <ReputationBadge tier={data.tier} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/[0.03] rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="w-3 h-3 text-gray-500" />
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Bets</span>
          </div>
          <span className="text-lg font-mono font-black text-white">{data.bets}</span>
        </div>

        <div className="bg-white/[0.03] rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Award className="w-3 h-3 text-gray-500" />
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Wins</span>
          </div>
          <span className="text-lg font-mono font-black text-new-mint">{data.wins}</span>
        </div>

        <div className="bg-white/[0.03] rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 text-gray-500" />
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Win Rate</span>
          </div>
          <span className="text-lg font-mono font-black text-white">
            {data.bets > 0 ? `${Math.round(data.winRate * 100)}%` : '—'}
          </span>
        </div>

        <div className="bg-white/[0.03] rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Flame className="w-3 h-3 text-gray-500" />
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Streak</span>
          </div>
          <span className="text-lg font-mono font-black text-amber-400">
            {data.streak > 0 ? `${data.streak}🔥` : '0'}
          </span>
        </div>
      </div>

      {/* Tier bonus info */}
      <div className="flex items-center justify-between bg-white/[0.02] rounded-xl px-4 py-2.5 border border-white/5">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
          Payout Bonus
        </span>
        <span className="text-sm font-mono font-bold text-new-mint">
          +{data.bonusPct}%
        </span>
      </div>

      <div className="flex items-center justify-between bg-white/[0.02] rounded-xl px-4 py-2.5 border border-white/5">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
          Platform Fee
        </span>
        <span className="text-sm font-mono font-bold text-gray-300">
          {data.feePct}%
        </span>
      </div>

      {/* Progress to next tier */}
      {data.nextTier && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
              Next: {data.nextTier}
            </span>
            <span className="text-[10px] font-mono text-gray-400">
              {data.progressToNext}%
            </span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${data.progressToNext}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-new-blue to-new-mint rounded-full"
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}

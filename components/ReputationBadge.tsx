'use client';

import { type ReputationTier } from '@/lib/predictionContract';

const TIER_CONFIG: Record<ReputationTier, { icon: string; color: string; bg: string; border: string }> = {
  Novice: { icon: '🌱', color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/20' },
  Trader: { icon: '📈', color: 'text-new-blue', bg: 'bg-new-blue/10', border: 'border-new-blue/20' },
  Whale:  { icon: '🐋', color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/20' },
  Oracle: { icon: '🔮', color: 'text-new-mint', bg: 'bg-new-mint/10', border: 'border-new-mint/20' },
};

interface ReputationBadgeProps {
  tier: ReputationTier;
  compact?: boolean;
}

export default function ReputationBadge({ tier, compact }: ReputationBadgeProps) {
  const cfg = TIER_CONFIG[tier];

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg.color} ${cfg.bg} border ${cfg.border}`}>
        <span>{cfg.icon}</span>
        {tier}
      </span>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${cfg.color} ${cfg.bg} border ${cfg.border}`}>
      <span className="text-sm">{cfg.icon}</span>
      <span>{tier}</span>
    </div>
  );
}

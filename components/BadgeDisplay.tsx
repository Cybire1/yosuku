'use client';

import type { Badge } from '@/lib/badges';
import {
  BadgeCheck,
  ChartNoAxesCombined,
  Crown,
  Droplets,
  Flame,
  Target,
  type LucideIcon,
} from 'lucide-react';

const BADGE_ICONS: Record<string, LucideIcon> = {
  first_trade: Target,
  winning_streak: Flame,
  lp_provider: Droplets,
  whale: ChartNoAxesCombined,
  oracle: Crown,
};

export default function BadgeDisplay({ badges }: { badges: Badge[] }) {
  const earnedCount = badges.filter((badge) => badge.earned).length;
  const total = badges.length;
  const progress = total > 0 ? Math.round((earnedCount / total) * 100) : 0;
  const nextBadge = badges.find((badge) => !badge.earned);

  return (
    <div className="flex flex-col overflow-hidden rounded border border-white/[0.08] bg-bg xl:flex-row">
      <div className="flex min-h-32 flex-col justify-between border-b border-white/[0.06] bg-white/[0.02] p-5 xl:w-56 xl:shrink-0 xl:border-b-0 xl:border-r">
        <div>
          <div className="font-mono text-[10px] uppercase text-gray-500">Season Rank</div>
          <div className="mt-2 flex items-baseline gap-1 font-display text-5xl font-extrabold leading-none text-white">
            {earnedCount}<span className="text-xl text-gray-700">/</span>{total}
          </div>
          <div className="mt-3 font-mono text-[11px] leading-relaxed text-gray-500">
            {nextBadge ? `Next: ${nextBadge.name}` : 'All ranks unlocked'}
          </div>
        </div>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-label={`${progress}% achievements unlocked`}>
          <span className="block h-full min-w-1.5 rounded-full bg-vermilion" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {badges.map((badge, index) => {
          const Icon = BADGE_ICONS[badge.id] ?? BadgeCheck;

          return (
            <div
              key={badge.id}
              className={`min-h-36 rounded border p-4 transition-colors ${
                badge.earned
                  ? 'border-vermilion/30 bg-vermilion/[0.06]'
                  : 'border-white/[0.06] bg-white/[0.018] opacity-45'
              }`}
              title={badge.description}
            >
              <div className="mb-5 flex items-center justify-between gap-3 font-mono text-[10px] uppercase">
                <span className={badge.earned ? 'text-vermilion' : 'text-gray-600'}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className={badge.earned ? 'text-vermilion' : 'text-gray-600'}>
                  {badge.earned ? 'Unlocked' : 'Locked'}
                </span>
              </div>
              <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-full border ${
                badge.earned
                  ? 'border-vermilion/35 bg-vermilion/[0.08] text-vermilion'
                  : 'border-white/[0.08] bg-black/30 text-gray-600'
              }`} aria-hidden="true">
                <Icon className="h-4 w-4" strokeWidth={1.9} />
              </div>
              <div className="text-sm font-extrabold leading-tight text-white">{badge.name}</div>
              <div className="mt-2 max-w-[22ch] text-xs leading-relaxed text-gray-500">{badge.description}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

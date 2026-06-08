'use client';

import type { Badge } from '@/lib/badges';

export default function BadgeDisplay({ badges }: { badges: Badge[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {badges.map(badge => (
        <div
          key={badge.id}
          className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border transition-all ${
            badge.earned
              ? 'border-vermilion/30 bg-vermilion/[0.06]'
              : 'border-white/5 bg-white/[0.02] opacity-40'
          }`}
          title={badge.description}
        >
          <span className="text-base">{badge.icon}</span>
          <div>
            <div className={`text-xs font-bold ${badge.earned ? 'text-white' : 'text-gray-600'}`}>
              {badge.name}
            </div>
            <div className="text-[10px] text-gray-500">{badge.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

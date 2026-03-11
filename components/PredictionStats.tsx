'use client';

import { useMemo } from 'react';
import { formatPred, type RoundState, type UserPosition } from '@/lib/predictionContract';
import { TrendingUp, Target, BarChart3, Flame } from 'lucide-react';
import { getSavedPayout } from '@/lib/roundHelpers';

interface PredictionStatsProps {
  rounds: RoundState[];
  positions: UserPosition[];
  address?: string | null;
}

export default function PredictionStats({ rounds, positions, address }: PredictionStatsProps) {
  const stats = useMemo(() => {
    const totalTrades = positions.length;
    let wins = 0;
    let losses = 0;
    let pnl = 0;
    let streak = 0;
    let streakType: 'W' | 'L' | null = null;

    // Process resolved rounds with user positions, sorted by id
    const resolved = rounds
      .filter(r => r.resolved && r.outcome !== null)
      .sort((a, b) => a.id - b.id);

    for (const round of resolved) {
      const pos = positions.find(p => p.roundId === round.id);
      if (!pos) continue;

      const userSide = pos.yesDeposit > 0 ? 'YES' : 'NO';
      const deposit = Math.max(pos.yesDeposit, pos.noDeposit);
      const winningSide = round.outcome ? 'YES' : 'NO';
      const isWin = userSide === winningSide;

      if (isWin) {
        wins++;
        const payout = address ? getSavedPayout(address, round.id) : 0;
        pnl += payout - deposit;
        if (streakType === 'W') streak++;
        else { streak = 1; streakType = 'W'; }
      } else {
        losses++;
        pnl -= deposit;
        if (streakType === 'L') streak++;
        else { streak = 1; streakType = 'L'; }
      }
    }

    const resolvedWithPos = wins + losses;
    const winRate = resolvedWithPos > 0 ? Math.round((wins / resolvedWithPos) * 100) : 0;

    return { totalTrades, winRate, pnl, streak, streakType };
  }, [address, rounds, positions]);

  if (stats.totalTrades === 0) return null;

  const cards = [
    {
      label: 'Trades',
      value: String(stats.totalTrades),
      icon: BarChart3,
      color: 'text-new-blue',
      bg: 'bg-new-blue/10',
    },
    {
      label: 'Win Rate',
      value: `${stats.winRate}%`,
      icon: Target,
      color: stats.winRate >= 50 ? 'text-new-mint' : 'text-off-red',
      bg: stats.winRate >= 50 ? 'bg-new-mint/10' : 'bg-off-red/10',
    },
    {
      label: 'P&L',
      value: `${stats.pnl >= 0 ? '+' : ''}${formatPred(stats.pnl)}`,
      icon: TrendingUp,
      color: stats.pnl >= 0 ? 'text-new-mint' : 'text-off-red',
      bg: stats.pnl >= 0 ? 'bg-new-mint/10' : 'bg-off-red/10',
    },
    {
      label: 'Streak',
      value: `${stats.streak}${stats.streakType || ''}`,
      icon: Flame,
      color: stats.streakType === 'W' ? 'text-new-mint' : stats.streakType === 'L' ? 'text-off-red' : 'text-gray-400',
      bg: stats.streakType === 'W' ? 'bg-new-mint/10' : stats.streakType === 'L' ? 'bg-off-red/10' : 'bg-white/5',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map(({ label, value, icon: Icon, color, bg }) => (
        <div
          key={label}
          className="bg-neutral-900/40 border border-white/5 rounded-xl p-3 flex items-center gap-2.5"
        >
          <div className={`w-7 h-7 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-3.5 h-3.5 ${color}`} />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block">
              {label}
            </span>
            <span className={`text-sm font-mono font-bold ${color}`}>
              {value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

import type { ManagerPositionSummary } from '@/lib/sui/predictApi';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earned: boolean;
}

export function computeBadges(
  positions: ManagerPositionSummary[],
  plpBalance: number,
  volume?: number
): Badge[] {
  const settledPositions = positions.filter(p => p.status === 'settled');
  const winningPositions = settledPositions.filter(p => p.realized_pnl > 0);
  const totalVolume = volume ?? positions.reduce((s, p) => s + p.minted_quantity, 0) / DUSDC_MULTIPLIER;

  // Winning streak: check consecutive wins from most recent
  let streak = 0;
  for (const p of [...settledPositions].reverse()) {
    if (p.realized_pnl > 0) streak++;
    else break;
  }

  const winRate = settledPositions.length >= 10
    ? winningPositions.length / settledPositions.length
    : 0;

  return [
    {
      id: 'first_trade',
      name: 'First Trade',
      description: 'Opened your first position.',
      icon: '🎯',
      earned: positions.length > 0,
    },
    {
      id: 'winning_streak',
      name: 'Hot Streak',
      description: '3 consecutive winning trades.',
      icon: '🔥',
      earned: streak >= 3,
    },
    {
      id: 'lp_provider',
      name: 'LP Provider',
      description: 'Supplied liquidity to the vault.',
      icon: '💧',
      earned: plpBalance > 0,
    },
    {
      id: 'whale',
      name: 'Whale',
      description: 'Traded over 1,000 DUSDC in volume.',
      icon: '🐋',
      earned: totalVolume >= 1000,
    },
    {
      id: 'oracle',
      name: 'Oracle',
      description: '70%+ win rate with 10+ settled trades.',
      icon: '🔮',
      earned: winRate >= 0.7 && settledPositions.length >= 10,
    },
  ];
}

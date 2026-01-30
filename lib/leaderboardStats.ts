// Leaderboard statistics aggregation
import { getAllPositions, type StoredPosition } from './positionStorage';

export interface TraderStats {
  address: string;
  totalVolume: number;
  totalProfit: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  accuracy: number; // percentage
  avgTradeSize: number;
  rank?: number;
}

export type LeaderboardCategory = 'volume' | 'profit' | 'accuracy';
export type TimePeriod = 'week' | 'month' | 'all';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function calculateTraderStats(timePeriod: TimePeriod = 'all'): TraderStats[] {
  const positions = getAllPositions();
  const now = Date.now();

  // Filter by time period
  const filteredPositions = positions.filter(p => {
    if (timePeriod === 'all') return true;
    const timeDiff = now - p.timestamp;
    if (timePeriod === 'week') return timeDiff <= WEEK_MS;
    if (timePeriod === 'month') return timeDiff <= MONTH_MS;
    return true;
  });

  // Group by trader address
  const traderMap = new Map<string, StoredPosition[]>();
  filteredPositions.forEach(position => {
    const existing = traderMap.get(position.userAddress) || [];
    existing.push(position);
    traderMap.set(position.userAddress, existing);
  });

  // Calculate stats for each trader
  const stats: TraderStats[] = [];

  traderMap.forEach((positions, address) => {
    let totalVolume = 0;
    let totalProfit = 0;
    let winningTrades = 0;
    let losingTrades = 0;

    positions.forEach(position => {
      const tradeVolume = position.shares * position.entryPrice;
      totalVolume += tradeVolume;

      // For P&L calculation, we need market data
      // Simplified: assume current price is stored or calculated
      // In real implementation, fetch from markets
      const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]');
      const market = markets.find((m: any) => m.id.toString() === position.marketId);

      if (market) {
        const totalShares = market.total_yes_shares + market.total_no_shares;
        const currentPrice = totalShares > 0
          ? (position.side === 'YES'
              ? market.total_yes_shares / totalShares
              : market.total_no_shares / totalShares)
          : position.entryPrice;

        const profitLoss = (currentPrice - position.entryPrice) * position.shares;
        totalProfit += profitLoss;

        if (profitLoss > 0) winningTrades++;
        else if (profitLoss < 0) losingTrades++;
      }
    });

    const totalTrades = positions.length;
    const accuracy = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const avgTradeSize = totalTrades > 0 ? totalVolume / totalTrades : 0;

    stats.push({
      address,
      totalVolume,
      totalProfit,
      totalTrades,
      winningTrades,
      losingTrades,
      accuracy,
      avgTradeSize,
    });
  });

  return stats;
}

export function getLeaderboard(
  category: LeaderboardCategory,
  timePeriod: TimePeriod = 'all',
  limit: number = 100
): TraderStats[] {
  const stats = calculateTraderStats(timePeriod);

  // Sort by category
  let sorted: TraderStats[];
  if (category === 'volume') {
    sorted = stats.sort((a, b) => b.totalVolume - a.totalVolume);
  } else if (category === 'profit') {
    sorted = stats.sort((a, b) => b.totalProfit - a.totalProfit);
  } else if (category === 'accuracy') {
    // Only include traders with at least 5 trades for accuracy ranking
    sorted = stats
      .filter(s => s.totalTrades >= 5)
      .sort((a, b) => b.accuracy - a.accuracy);
  } else {
    sorted = stats;
  }

  // Add ranks
  sorted.forEach((stat, index) => {
    stat.rank = index + 1;
  });

  return sorted.slice(0, limit);
}

export function getUserRank(
  userAddress: string,
  category: LeaderboardCategory,
  timePeriod: TimePeriod = 'all'
): { stats: TraderStats | null; rank: number } {
  const leaderboard = getLeaderboard(category, timePeriod, 1000);
  const userStats = leaderboard.find(s => s.address === userAddress);

  if (!userStats) {
    return { stats: null, rank: -1 };
  }

  return { stats: userStats, rank: userStats.rank || -1 };
}

export function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatVolume(volume: number): string {
  if (volume >= 1000) return `${(volume / 1000).toFixed(1)}K`;
  return volume.toFixed(2);
}

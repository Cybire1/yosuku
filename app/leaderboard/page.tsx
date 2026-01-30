'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trophy, TrendingUp, Target, ArrowLeft, Medal, Award, Crown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import Header from '@/components/Header';
import {
  getLeaderboard,
  getUserRank,
  formatAddress,
  formatVolume,
  type LeaderboardCategory,
  type TimePeriod,
  type TraderStats
} from '@/lib/leaderboardStats';

export default function LeaderboardPage() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [category, setCategory] = useState<LeaderboardCategory>('volume');
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('all');
  const [leaderboard, setLeaderboard] = useState<TraderStats[]>([]);
  const [userRank, setUserRank] = useState<{ stats: TraderStats | null; rank: number } | null>(null);

  useEffect(() => {
    updateLeaderboard();
  }, [category, timePeriod, publicKey]);

  const updateLeaderboard = () => {
    const data = getLeaderboard(category, timePeriod, 100);
    setLeaderboard(data);

    if (publicKey) {
      const rank = getUserRank(publicKey, category, timePeriod);
      setUserRank(rank);
    } else {
      setUserRank(null);
    }
  };

  const getCategoryLabel = (cat: LeaderboardCategory) => {
    if (cat === 'volume') return 'Volume';
    if (cat === 'profit') return 'Profit';
    if (cat === 'accuracy') return 'Accuracy';
    return '';
  };

  const getPeriodLabel = (period: TimePeriod) => {
    if (period === 'week') return 'Week';
    if (period === 'month') return 'Month';
    if (period === 'all') return 'All Time';
    return '';
  };

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Crown className="w-5 h-5 text-new-mint" />;
    if (rank === 2) return <Medal className="w-5 h-5 text-gray-400" />;
    if (rank === 3) return <Award className="w-5 h-5 text-orange-400" />;
    return null;
  };

  const getRankColor = (rank: number) => {
    if (rank === 1) return 'text-new-mint';
    if (rank === 2) return 'text-gray-400';
    if (rank === 3) return 'text-orange-400';
    return 'text-gray-500';
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-off-blue/30 overflow-x-hidden">
      <div className="fixed inset-0 bg-noise opacity-[0.03] pointer-events-none z-50"></div>
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-new-mint/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-new-mint/5 blur-[120px] rounded-full"></div>
      </div>

      <Header />

      <main className="container mx-auto px-4 py-32 relative z-10">
        <div className="max-w-6xl mx-auto">
          {/* Back Button */}
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-12 text-sm font-bold uppercase tracking-widest group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back to Markets
          </button>

          {/* Header */}
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-4">
              <Trophy className="w-12 h-12 text-new-mint" />
              <h1 className="text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-500">
                Leaderboard
              </h1>
            </div>
            <p className="text-xl text-gray-400 max-w-2xl leading-relaxed">
              Top traders on Dart. Compete for the top spot and earn bragging rights.
            </p>
          </div>

          {/* Filters */}
          <div className="mb-8 flex flex-col md:flex-row gap-4">
            {/* Category Tabs */}
            <div className="relative flex-1">
              <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-xl" />
              <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />
              <div className="relative p-2 flex gap-2">
                {(['volume', 'profit', 'accuracy'] as LeaderboardCategory[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={`flex-1 px-4 py-3 rounded-lg font-bold uppercase tracking-widest text-xs transition-all ${category === cat
                        ? 'bg-new-mint text-black'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                  >
                    {getCategoryLabel(cat)}
                  </button>
                ))}
              </div>
            </div>

            {/* Time Period Tabs */}
            <div className="relative">
              <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-xl" />
              <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />
              <div className="relative p-2 flex gap-2">
                {(['week', 'month', 'all'] as TimePeriod[]).map((period) => (
                  <button
                    key={period}
                    onClick={() => setTimePeriod(period)}
                    className={`px-4 py-3 rounded-lg font-bold uppercase tracking-widest text-xs transition-all ${timePeriod === period
                        ? 'bg-white/10 text-white'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                  >
                    {getPeriodLabel(period)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* User's Rank Card */}
          {publicKey && userRank && userRank.stats && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative mb-8"
            >
              <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-new-mint/30 rounded-2xl" />
              <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />
              <div className="relative p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-new-mint/20 flex items-center justify-center text-new-mint font-black text-xl">
                      #{userRank.rank}
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Your Rank</div>
                      <div className="text-xl font-bold text-white">{formatAddress(publicKey)}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-6 text-center">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Volume</div>
                      <div className="text-xl font-black text-white">{formatVolume(userRank.stats.totalVolume)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Profit</div>
                      <div className={`text-xl font-black ${userRank.stats.totalProfit >= 0 ? 'text-off-green' : 'text-off-red'}`}>
                        {userRank.stats.totalProfit >= 0 ? '+' : ''}{userRank.stats.totalProfit.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Accuracy</div>
                      <div className="text-xl font-black text-white">{userRank.stats.accuracy.toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Leaderboard Table */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="relative"
          >
            <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-2xl" />
            <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />

            <div className="relative overflow-hidden rounded-2xl">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-8 py-4 border-b border-white/10 text-xs font-bold uppercase tracking-widest text-gray-500">
                <div className="col-span-1">Rank</div>
                <div className="col-span-3">Trader</div>
                <div className="col-span-2 text-right">Volume</div>
                <div className="col-span-2 text-right">Profit</div>
                <div className="col-span-2 text-right">Trades</div>
                <div className="col-span-2 text-right">Accuracy</div>
              </div>

              {/* Table Body */}
              <div className="max-h-[600px] overflow-y-auto">
                {leaderboard.length === 0 ? (
                  <div className="p-20 text-center">
                    <Target className="w-16 h-16 mx-auto text-gray-600 mb-4" />
                    <h3 className="text-xl font-bold text-gray-400 mb-2">No Data Yet</h3>
                    <p className="text-gray-500">Start trading to appear on the leaderboard!</p>
                  </div>
                ) : (
                  leaderboard.map((trader, index) => (
                    <motion.div
                      key={trader.address}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className={`grid grid-cols-12 gap-4 px-8 py-5 border-b border-white/5 hover:bg-white/5 transition-all ${publicKey && trader.address === publicKey ? 'bg-new-mint/5' : ''
                        }`}
                    >
                      {/* Rank */}
                      <div className="col-span-1 flex items-center gap-2">
                        {getRankIcon(trader.rank || 0)}
                        <span className={`text-lg font-black ${getRankColor(trader.rank || 0)}`}>
                          #{trader.rank}
                        </span>
                      </div>

                      {/* Trader Address */}
                      <div className="col-span-3 flex items-center">
                        <span className="font-mono text-white font-bold">
                          {formatAddress(trader.address)}
                        </span>
                      </div>

                      {/* Volume */}
                      <div className="col-span-2 text-right flex items-center justify-end">
                        <span className="text-white font-bold">{formatVolume(trader.totalVolume)} ALEO</span>
                      </div>

                      {/* Profit */}
                      <div className="col-span-2 text-right flex items-center justify-end">
                        <span className={`font-black ${trader.totalProfit >= 0 ? 'text-off-green' : 'text-off-red'}`}>
                          {trader.totalProfit >= 0 ? '+' : ''}{trader.totalProfit.toFixed(2)}
                        </span>
                      </div>

                      {/* Trades */}
                      <div className="col-span-2 text-right flex items-center justify-end">
                        <div>
                          <div className="text-white font-bold">{trader.totalTrades}</div>
                          <div className="text-xs text-gray-500">
                            {trader.winningTrades}W / {trader.losingTrades}L
                          </div>
                        </div>
                      </div>

                      {/* Accuracy */}
                      <div className="col-span-2 text-right flex items-center justify-end">
                        <span className="text-white font-bold">{trader.accuracy.toFixed(1)}%</span>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, TrendingUp, Clock, Users, DollarSign, Info, Calendar } from 'lucide-react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import Header from '@/components/Header';
import BetModal from '@/components/BetModal';
import MarketAnalytics from '@/components/MarketAnalytics';
import type { Market } from '@/components/MarketCard';

export default function MarketDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { publicKey } = useWallet();
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBetModal, setShowBetModal] = useState(false);
  const [selectedSide, setSelectedSide] = useState<'YES' | 'NO'>('YES');
  const [relatedMarkets, setRelatedMarkets] = useState<Market[]>([]);

  useEffect(() => {
    fetchMarketDetails();
  }, [params.id]);

  const fetchMarketDetails = async () => {
    setLoading(true);
    try {
      // Fetch from localStorage (Aleo markets)
      const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]');
      const foundMarket = markets.find((m: any) => m.id.toString() === params.id);

      if (foundMarket) {
        // Calculate current odds
        const totalShares = foundMarket.total_yes_shares + foundMarket.total_no_shares;
        const yesOdds = totalShares > 0 ? (foundMarket.total_yes_shares / totalShares) * 100 : 50;
        const noOdds = totalShares > 0 ? (foundMarket.total_no_shares / totalShares) * 100 : 50;

        setMarket({
          id: foundMarket.id,
          question: foundMarket.question,
          end_timestamp: foundMarket.end_timestamp,
          total_yes_shares: foundMarket.total_yes_shares,
          total_no_shares: foundMarket.total_no_shares,
          total_volume: foundMarket.total_volume || 0,
          resolved: foundMarket.resolved || false,
          creator: foundMarket.creator,
          yes_odds: yesOdds,
          no_odds: noOdds,
        });

        // Get related markets (random 3 from same creator or recent)
        const related = markets
          .filter((m: any) => m.id !== foundMarket.id && !m.resolved)
          .slice(0, 3)
          .map((m: any) => {
            const total = m.total_yes_shares + m.total_no_shares;
            return {
              id: m.id,
              question: m.question,
              end_timestamp: m.end_timestamp,
              total_yes_shares: m.total_yes_shares,
              total_no_shares: m.total_no_shares,
              total_volume: m.total_volume || 0,
              resolved: m.resolved || false,
              creator: m.creator,
              yes_odds: total > 0 ? (m.total_yes_shares / total) * 100 : 50,
              no_odds: total > 0 ? (m.total_no_shares / total) * 100 : 50,
            };
          });
        setRelatedMarkets(related);
      }
    } catch (error) {
      console.error('Error fetching market:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBet = (side: 'YES' | 'NO') => {
    if (!publicKey) {
      alert('Please connect your wallet first');
      return;
    }
    setSelectedSide(side);
    setShowBetModal(true);
  };

  const formatTimeRemaining = (timestamp: number) => {
    const now = Date.now() / 1000;
    const remaining = timestamp - now;

    if (remaining <= 0) return 'Ended';

    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);

    if (days > 0) return `${days}d ${hours}h remaining`;
    return `${hours}h remaining`;
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-white/10 border-t-new-mint"></div>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Header />
        <main className="container mx-auto px-4 py-32 text-center">
          <h1 className="text-4xl font-black mb-4">Market Not Found</h1>
          <button
            onClick={() => router.push('/')}
            className="px-8 py-4 bg-white text-black font-bold rounded-xl hover:bg-new-mint transition-all"
          >
            Back to Markets
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-off-blue/30 overflow-x-hidden">
      <div className="fixed inset-0 bg-noise opacity-[0.03] pointer-events-none z-50"></div>
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-off-green/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-off-red/10 blur-[120px] rounded-full"></div>
      </div>

      <Header />

      <main className="container mx-auto px-4 py-32 relative z-10">
        <div className="max-w-5xl mx-auto">
          {/* Back Button */}
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-12 text-sm font-bold uppercase tracking-widest group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back to Markets
          </button>

          {/* Market Question */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <h1 className="text-5xl md:text-6xl font-black tracking-tight leading-tight mb-6">
              {market.question}
            </h1>

            {/* Time & Status */}
            <div className="flex items-center gap-4 text-gray-400">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <span className="text-sm font-mono">{formatDate(market.end_timestamp)}</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span className="text-sm font-bold">{formatTimeRemaining(market.end_timestamp)}</span>
              </div>
            </div>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
            {/* Main Trading Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="lg:col-span-2 relative"
            >
              <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-3xl" />
              <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-3xl pointer-events-none" />

              <div className="relative p-8">
                <h2 className="text-2xl font-black uppercase tracking-tight mb-8">Place Your Bet</h2>

                {/* YES/NO Buttons */}
                <div className="grid grid-cols-2 gap-4 mb-8">
                  {/* YES Button */}
                  <button
                    onClick={() => handleBet('YES')}
                    disabled={market.resolved}
                    className="group relative overflow-hidden rounded-2xl p-8 bg-off-green/5 border-2 border-off-green/20 hover:border-off-green/50 hover:bg-off-green/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="relative z-10">
                      <div className="text-sm font-bold uppercase tracking-widest text-off-green mb-2">Yes</div>
                      <div className="text-4xl font-black text-white mb-2">{market.yes_odds?.toFixed(0)}%</div>
                      <div className="text-xs text-gray-400">{market.total_yes_shares.toFixed(0)} shares</div>
                    </div>
                    <div className="absolute inset-0 bg-off-green/0 group-hover:bg-off-green/5 transition-all" />
                  </button>

                  {/* NO Button */}
                  <button
                    onClick={() => handleBet('NO')}
                    disabled={market.resolved}
                    className="group relative overflow-hidden rounded-2xl p-8 bg-off-red/5 border-2 border-off-red/20 hover:border-off-red/50 hover:bg-off-red/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="relative z-10">
                      <div className="text-sm font-bold uppercase tracking-widest text-off-red mb-2">No</div>
                      <div className="text-4xl font-black text-white mb-2">{market.no_odds?.toFixed(0)}%</div>
                      <div className="text-xs text-gray-400">{market.total_no_shares.toFixed(0)} shares</div>
                    </div>
                    <div className="absolute inset-0 bg-off-red/0 group-hover:bg-off-red/5 transition-all" />
                  </button>
                </div>

                {/* Visual Probability Bar */}
                <div className="relative h-16 bg-neutral-950 rounded-xl overflow-hidden border border-white/10">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-off-green/30 to-off-green/10 border-r-2 border-off-green/50"
                    style={{ width: `${market.yes_odds}%` }}
                  />
                  <div
                    className="absolute inset-y-0 right-0 bg-gradient-to-l from-off-red/30 to-off-red/10 border-l-2 border-off-red/50"
                    style={{ width: `${market.no_odds}%` }}
                  />

                  {/* Labels */}
                  <div className="absolute inset-0 flex items-center justify-between px-6">
                    <span className="text-off-green font-bold text-lg z-10">YES {market.yes_odds?.toFixed(0)}%</span>
                    <span className="text-off-red font-bold text-lg z-10">NO {market.no_odds?.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Stats Sidebar */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-4"
            >
              {/* Volume */}
              <div className="relative">
                <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-xl" />
                <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />
                <div className="relative p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <DollarSign className="w-5 h-5 text-gray-500" />
                    <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Volume</span>
                  </div>
                  <div className="text-2xl font-black text-white">{market.total_volume.toFixed(2)} <span className="text-sm text-gray-500">ALEO</span></div>
                </div>
              </div>

              {/* Total Shares */}
              <div className="relative">
                <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-xl" />
                <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />
                <div className="relative p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <Users className="w-5 h-5 text-gray-500" />
                    <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Total Shares</span>
                  </div>
                  <div className="text-2xl font-black text-white">{(market.total_yes_shares + market.total_no_shares).toFixed(0)}</div>
                </div>
              </div>

              {/* Market ID */}
              <div className="relative">
                <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-xl" />
                <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />
                <div className="relative p-6">
                  <div className="flex items-center gap-3 mb-2">
                    <Info className="w-5 h-5 text-gray-500" />
                    <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Market ID</span>
                  </div>
                  <div className="text-lg font-mono text-white">#{market.id}</div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Market Analytics */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-12"
          >
            <MarketAnalytics marketId={market.id.toString()} />
          </motion.div>

          {/* Resolution Criteria */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="relative mb-12"
          >
            <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-2xl" />
            <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />
            <div className="relative p-8">
              <h3 className="text-xl font-black uppercase tracking-tight mb-4 flex items-center gap-3">
                <Info className="w-5 h-5 text-off-blue" />
                Resolution Criteria
              </h3>
              <p className="text-gray-400 leading-relaxed">
                This market will be resolved by the creator based on the outcome of the stated question.
                Resolution will occur after the end date. Winners will be able to claim their earnings (2x payout)
                after resolution. All trades are final and non-refundable.
              </p>
            </div>
          </motion.div>

          {/* Related Markets */}
          {relatedMarkets.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              <h3 className="text-2xl font-black uppercase tracking-tight mb-6">Related Markets</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {relatedMarkets.map((related, idx) => (
                  <div
                    key={related.id}
                    onClick={() => router.push(`/market/${related.id}`)}
                    className="relative group cursor-pointer"
                  >
                    <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 group-hover:border-white/30 rounded-xl transition-all" />
                    <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />
                    <div className="relative p-6">
                      <h4 className="text-sm font-bold text-white mb-3 line-clamp-2 group-hover:text-off-blue transition-colors">
                        {related.question}
                      </h4>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-off-green font-bold">YES {related.yes_odds?.toFixed(0)}%</span>
                        <span className="text-off-red font-bold">NO {related.no_odds?.toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </main>

      {/* Bet Modal */}
      {showBetModal && market && (
        <BetModal
          market={market}
          side={selectedSide}
          onClose={() => setShowBetModal(false)}
        />
      )}
    </div>
  );
}

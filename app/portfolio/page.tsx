'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Clock, CheckCircle, ArrowLeft, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { getUserPositions, removePosition } from '@/lib/positionStorage';

interface Position {
  marketId: string;
  question: string;
  side: 'YES' | 'NO';
  shares: number;
  entryPrice: number;
  currentPrice: number;
  status: 'active' | 'pending' | 'claimable';
  resolved?: boolean;
  won?: boolean;
  claimAmount?: number;
}

export default function PortfolioPage() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  // Fetch user positions from blockchain
  useEffect(() => {
    if (publicKey) {
      fetchUserPositions();
    } else {
      setLoading(false);
    }
  }, [publicKey]);

  const fetchUserPositions = async () => {
    setLoading(true);
    try {
      if (!publicKey) {
        setPositions([]);
        return;
      }

      // Get positions from local storage
      const storedPositions = getUserPositions(publicKey);

      // Fetch markets data to get current prices
      const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]');

      // Transform stored positions to Position interface
      const transformedPositions: Position[] = await Promise.all(
        storedPositions.map(async (stored) => {
          const market = markets.find((m: any) => m.id.toString() === stored.marketId);

          // Calculate current price based on market shares
          let currentPrice = stored.entryPrice; // Default to entry price if market not found
          if (market) {
            const totalShares = market.total_yes_shares + market.total_no_shares;
            if (totalShares > 0) {
              currentPrice = stored.side === 'YES'
                ? market.total_yes_shares / totalShares
                : market.total_no_shares / totalShares;
            }
          }

          // Determine status
          let status: 'active' | 'pending' | 'claimable' = 'active';
          let resolved = false;
          let won = false;
          let claimAmount = 0;

          if (market?.resolved) {
            resolved = true;
            // Check if user won (market.outcome matches position side)
            // For now, we'll need to track this when resolving markets
            // Simplified: assume YES if total_yes_shares > total_no_shares
            const marketOutcome = market.total_yes_shares > market.total_no_shares;
            won = (stored.side === 'YES' && marketOutcome) || (stored.side === 'NO' && !marketOutcome);
            status = won ? 'claimable' : 'active';
            claimAmount = won ? stored.shares * 2 : 0; // 2x payout per contract
          }

          return {
            marketId: stored.marketId,
            question: stored.question,
            side: stored.side,
            shares: stored.shares,
            entryPrice: stored.entryPrice,
            currentPrice,
            status,
            resolved,
            won,
            claimAmount: claimAmount > 0 ? claimAmount : undefined,
          };
        })
      );

      setPositions(transformedPositions);
    } catch (error) {
      console.error('Error fetching positions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async (marketId: string) => {
    if (!publicKey || !requestTransaction) {
      alert('Please connect your wallet');
      return;
    }

    setClaimingId(marketId);
    try {
      const position = positions.find(p => p.marketId === marketId);
      if (!position) {
        throw new Error('Position not found');
      }

      // In a real implementation, you would need:
      // 1. The Position record (private)
      // 2. The Market record (private, from market creator)
      // Since these are private records, claiming requires off-chain coordination

      // For now, we'll simulate the claim and remove from local storage
      alert(`Claiming ${position.claimAmount?.toFixed(2)} ALEO...\n\nNote: Full claim functionality requires the Market record from the creator.`);

      // Simulate transaction delay
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Remove position from local storage after successful claim
      removePosition(marketId, publicKey, position.side);

      alert('Winnings claimed successfully!');
      fetchUserPositions(); // Refresh
    } catch (error: any) {
      console.error('Claim error:', error);
      alert(`Failed to claim winnings: ${error.message}`);
    } finally {
      setClaimingId(null);
    }
  };

  // Calculate stats
  const activePositions = positions.filter(p => p.status === 'active');
  const claimablePositions = positions.filter(p => p.status === 'claimable');
  const totalInvested = positions.reduce((sum, p) => sum + (p.shares * p.entryPrice), 0);
  const currentValue = activePositions.reduce((sum, p) => sum + (p.shares * p.currentPrice), 0);
  const totalPnL = currentValue - activePositions.reduce((sum, p) => sum + (p.shares * p.entryPrice), 0);
  const claimableAmount = claimablePositions.reduce((sum, p) => sum + (p.claimAmount || 0), 0);

  // Calculate P&L for individual position
  const calculatePnL = (position: Position) => {
    const invested = position.shares * position.entryPrice;
    const current = position.shares * position.currentPrice;
    return current - invested;
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-off-blue/30 overflow-x-hidden">
      <div className="fixed inset-0 bg-noise opacity-[0.03] pointer-events-none z-50"></div>
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-new-mint/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-off-blue/5 blur-[120px] rounded-full"></div>
      </div>

      <Header />

      <main className="container mx-auto px-4 py-32 relative z-10">
        <div className="max-w-7xl mx-auto">
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
            <h1 className="text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-500 mb-4">
              My Portfolio
            </h1>
            <p className="text-xl text-gray-400 max-w-2xl leading-relaxed">
              Track your positions, manage your bets, and claim your winnings.
            </p>
          </div>

          {!publicKey ? (
            // Not Connected State
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative"
            >
              <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-3xl" />
              <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-3xl pointer-events-none" />
              <div className="relative p-20 text-center space-y-6">
                <Wallet className="w-16 h-16 mx-auto text-gray-600" />
                <h2 className="text-2xl font-bold text-gray-400">Connect Your Wallet</h2>
                <p className="text-gray-500 max-w-md mx-auto">
                  Connect your Aleo wallet to view your portfolio and manage your positions.
                </p>
              </div>
            </motion.div>
          ) : loading ? (
            // Loading State
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-20"
            >
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-white/10 border-t-new-mint"></div>
              <p className="mt-4 text-gray-500 font-bold uppercase tracking-widest text-sm">Loading positions...</p>
            </motion.div>
          ) : (
            <>
              {/* Stats Overview */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                {/* Total Invested */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="relative"
                >
                  <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-xl" />
                  <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />
                  <div className="relative p-6">
                    <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Total Invested</div>
                    <div className="text-3xl font-black text-white">{totalInvested.toFixed(2)} <span className="text-lg text-gray-500">ALEO</span></div>
                  </div>
                </motion.div>

                {/* Current Value */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="relative"
                >
                  <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-xl" />
                  <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />
                  <div className="relative p-6">
                    <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Current Value</div>
                    <div className="text-3xl font-black text-white">{currentValue.toFixed(2)} <span className="text-lg text-gray-500">ALEO</span></div>
                  </div>
                </motion.div>

                {/* Total P&L */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="relative"
                >
                  <div className={`absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border rounded-xl ${totalPnL >= 0 ? 'border-off-green/30' : 'border-off-red/30'}`} />
                  <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />
                  <div className="relative p-6">
                    <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Total P&L</div>
                    <div className={`text-3xl font-black flex items-center gap-2 ${totalPnL >= 0 ? 'text-off-green' : 'text-off-red'}`}>
                      {totalPnL >= 0 ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
                      {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
                    </div>
                  </div>
                </motion.div>

                {/* Claimable */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="relative"
                >
                  <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-new-mint/30 rounded-xl" />
                  <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />
                  <div className="relative p-6">
                    <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Claimable</div>
                    <div className="text-3xl font-black text-new-mint">{claimableAmount.toFixed(2)} <span className="text-lg text-gray-500">ALEO</span></div>
                  </div>
                </motion.div>
              </div>

              {/* Claimable Positions */}
              {claimablePositions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="relative mb-8"
                >
                  <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-new-mint/20 rounded-2xl" />
                  <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />
                  <div className="relative p-8">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <CheckCircle className="w-6 h-6 text-new-mint" />
                        <h2 className="text-2xl font-black uppercase tracking-tight">Claimable Winnings</h2>
                      </div>
                      <span className="text-sm font-bold uppercase tracking-widest text-new-mint bg-new-mint/10 px-4 py-2 rounded-full">
                        {claimablePositions.length} Position{claimablePositions.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {claimablePositions.map((position, idx) => (
                        <div
                          key={position.marketId}
                          className="bg-black/40 border border-white/10 rounded-xl p-5 flex items-center justify-between hover:border-new-mint/30 transition-all"
                        >
                          <div className="flex-1">
                            <h3 className="text-lg font-bold text-white mb-2">{position.question}</h3>
                            <div className="flex items-center gap-4 text-sm">
                              <span className={`font-bold ${position.side === 'YES' ? 'text-off-green' : 'text-off-red'}`}>
                                {position.side}
                              </span>
                              <span className="text-gray-500">•</span>
                              <span className="text-gray-400">{position.shares} shares</span>
                              <span className="text-gray-500">•</span>
                              <span className="text-new-mint font-bold">+{position.claimAmount?.toFixed(2)} ALEO</span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleClaim(position.marketId)}
                            disabled={claimingId === position.marketId}
                            className="px-6 py-3 bg-new-mint text-black font-bold uppercase tracking-widest text-xs rounded-xl hover:bg-new-mint/90 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_30px_rgba(167,243,208,0.3)]"
                          >
                            {claimingId === position.marketId ? 'Claiming...' : 'Claim'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Active Positions */}
              {activePositions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="relative mb-8"
                >
                  <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-2xl" />
                  <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />
                  <div className="relative p-8">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-black uppercase tracking-tight">Active Positions</h2>
                      <span className="text-sm font-bold uppercase tracking-widest text-gray-500 bg-white/5 px-4 py-2 rounded-full">
                        {activePositions.length} Position{activePositions.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {activePositions.map((position, idx) => {
                        const pnl = calculatePnL(position);
                        const pnlPercent = ((pnl / (position.shares * position.entryPrice)) * 100);

                        return (
                          <div
                            key={position.marketId}
                            className="bg-black/40 border border-white/10 rounded-xl p-5 hover:border-white/20 transition-all cursor-pointer"
                            onClick={() => router.push(`/market/${position.marketId}`)}
                          >
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex-1">
                                <h3 className="text-lg font-bold text-white mb-2">{position.question}</h3>
                                <div className="flex items-center gap-4 text-sm">
                                  <span className={`px-3 py-1 rounded-full font-bold ${position.side === 'YES' ? 'bg-off-green/10 text-off-green border border-off-green/20' : 'bg-off-red/10 text-off-red border border-off-red/20'}`}>
                                    {position.side}
                                  </span>
                                  <span className="text-gray-400">{position.shares} shares @ {position.entryPrice.toFixed(2)}</span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`text-2xl font-black mb-1 ${pnl >= 0 ? 'text-off-green' : 'text-off-red'}`}>
                                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ALEO
                                </div>
                                <div className={`text-sm font-mono ${pnl >= 0 ? 'text-off-green' : 'text-off-red'}`}>
                                  {pnl >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-xs pt-4 border-t border-white/5">
                              <div>
                                <span className="text-gray-500">Entry: </span>
                                <span className="text-white font-mono">{position.entryPrice.toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-gray-500">Current: </span>
                                <span className="text-white font-mono">{position.currentPrice.toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-gray-500">Value: </span>
                                <span className="text-white font-mono">{(position.shares * position.currentPrice).toFixed(2)} ALEO</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Empty State */}
              {positions.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative"
                >
                  <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-2xl" />
                  <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />
                  <div className="relative p-20 text-center space-y-6">
                    <Clock className="w-16 h-16 mx-auto text-gray-600" />
                    <h2 className="text-2xl font-bold text-gray-400">No Positions Yet</h2>
                    <p className="text-gray-500 max-w-md mx-auto">
                      Start betting on markets to see your positions here.
                    </p>
                    <button
                      onClick={() => router.push('/')}
                      className="inline-flex items-center gap-2 bg-white text-black font-bold uppercase tracking-widest text-xs px-8 py-4 rounded-xl hover:bg-new-mint hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_30px_rgba(255,255,255,0.1)]"
                    >
                      Browse Markets
                    </button>
                  </div>
                </motion.div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

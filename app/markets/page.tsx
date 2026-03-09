'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Header from '@/components/Header';
import TradingCard from '@/components/TradingCard';
import BetSidebar from '@/components/BetSidebar';
import WaitingState from '@/components/WaitingState';
import RoundHistory from '@/components/RoundHistory';
import Comments from '@/components/Comments';
import TokenBalance from '@/components/TokenBalance';
import TokenFaucet from '@/components/TokenFaucet';
import PredictionStats from '@/components/PredictionStats';
import PnLChart from '@/components/PnLChart';
import { useRounds } from '@/lib/hooks/useRounds';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { fetchRound, loadPositions, markClaimed } from '@/lib/roundHelpers';
import {
  DURATION_OPTIONS,
  formatPred,
  type DurationLabel,
} from '@/lib/predictionContract';
import { Activity, Timer, Trophy, XCircle, BarChart3, MessageCircle, BookOpen, History, Shield } from 'lucide-react';
import BitcoinIcon from '@/components/icons/BitcoinIcon';
import NewsFeed from '@/components/NewsFeed';
import TickerTape from '@/components/TickerTape';
import DoodleStrip from '@/components/DoodleStrip';

type BottomTab = 'activity' | 'comments' | 'stats' | 'rules';

export default function MarketsPage() {
  const { address } = useWallet();
  const { change24h } = useBtcPrice();
  const { activeRound, pastRounds, positions, loading, reloadPositions, setActiveRound, setPastRounds } = useRounds();

  const [mintTrigger, setMintTrigger] = useState(0);
  const [selectedDuration, setSelectedDuration] = useState<DurationLabel>('5 Minutes');
  const [notification, setNotification] = useState<{ type: 'win' | 'lose'; amount: number; roundId: number } | null>(null);
  const [bottomTab, setBottomTab] = useState<BottomTab>('comments');

  // Auto-select duration tab to match active round
  useEffect(() => {
    if (!activeRound) return;
    const durationSecs = activeRound.durationMs / 1000;
    const match = DURATION_OPTIONS.find(d => Math.abs(d.seconds - durationSecs) < 10);
    if (match) setSelectedDuration(match.label);
  }, [activeRound?.id]);

  // Check if active round's duration matches selected tab
  const durationMs = DURATION_OPTIONS.find(d => d.label === selectedDuration)!.seconds * 1000;
  const roundMatchesTab = activeRound && Math.abs(activeRound.durationMs - durationMs) < 10_000;

  // Show win/lose notification when round resolves (useRounds handles the actual transition)
  const prevRoundRef = useRef<{ id: number; resolved: boolean } | null>(null);
  useEffect(() => {
    if (!activeRound) {
      // Check if previous round just disappeared (resolved and transitioned by useRounds)
      if (prevRoundRef.current && !prevRoundRef.current.resolved) {
        // Round was active, now gone — check for notification from pastRounds
        const resolved = pastRounds.find(r => r.id === prevRoundRef.current!.id);
        if (resolved) {
          const currentPositions = loadPositions();
          const pos = currentPositions.find(p => p.roundId === resolved.id);
          if (pos) {
            const userSide = pos.yesDeposit > 0 ? 'YES' : 'NO';
            const winningSide = resolved.outcome ? 'YES' : 'NO';
            const userDeposit = Math.max(pos.yesDeposit, pos.noDeposit);
            const isWinner = userSide === winningSide;

            if (isWinner) {
              const totalPool = resolved.yesPool + resolved.noPool;
              const winPool = resolved.outcome ? resolved.yesPool : resolved.noPool;
              const payout = winPool > 0 ? (userDeposit / winPool) * totalPool * 0.9 : 0;
              setNotification({ type: 'win', amount: payout, roundId: resolved.id });
            } else {
              setNotification({ type: 'lose', amount: userDeposit, roundId: resolved.id });
            }
            setTimeout(() => setNotification(null), 8000);
          }
        }
      }
      prevRoundRef.current = null;
      return;
    }
    prevRoundRef.current = { id: activeRound.id, resolved: activeRound.resolved };
  }, [activeRound?.id, activeRound?.resolved, pastRounds]);

  const handleBetSuccess = () => {
    setMintTrigger(prev => prev + 1);
    reloadPositions();
    if (activeRound) {
      fetchRound(activeRound.id).then(updated => {
        if (updated) setActiveRound(prev => prev ? { ...updated, endTime: prev.endTime } : updated);
      });
    }
  };

  const handleClaim = (roundId: number) => {
    markClaimed(roundId);
    reloadPositions();
    setMintTrigger(prev => prev + 1);
  };

  const currentPosition = activeRound
    ? positions.find(p => p.roundId === activeRound.id)
    : undefined;

  const BOTTOM_TABS: { key: BottomTab; label: string; icon: typeof History }[] = [
    { key: 'activity', label: 'Activity', icon: History },
    { key: 'comments', label: 'Comments', icon: MessageCircle },
    { key: 'stats', label: 'Stats', icon: BarChart3 },
    { key: 'rules', label: 'Rules', icon: BookOpen },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden selection:bg-white selection:text-black">
      <Header />

      {/* Win/Lose notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: 'spring', damping: 20 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[55]"
          >
            <div className={`flex items-center gap-3 px-6 py-3.5 rounded-2xl border backdrop-blur-xl shadow-2xl ${notification.type === 'win'
              ? 'bg-new-mint/15 border-new-mint/30 shadow-new-mint/10'
              : 'bg-off-red/15 border-off-red/30 shadow-off-red/10'
              }`}>
              {notification.type === 'win' ? (
                <Trophy className="w-5 h-5 text-new-mint" />
              ) : (
                <XCircle className="w-5 h-5 text-off-red" />
              )}
              <div>
                <span className={`text-sm font-bold ${notification.type === 'win' ? 'text-new-mint' : 'text-off-red'}`}>
                  {notification.type === 'win' ? 'You Won!' : 'Round Lost'}
                </span>
                <span className="text-xs text-gray-400 ml-2">
                  Round #{notification.roundId} —{' '}
                  {notification.type === 'win'
                    ? `+${formatPred(notification.amount)} USDCx`
                    : `-${formatPred(notification.amount)} USDCx`
                  }
                </span>
              </div>
              {notification.type === 'win' && (
                <span className="text-xs font-bold text-new-mint/60 ml-2">Claim in history</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <DoodleStrip />
      <main className="pt-28 pb-24 sm:pb-12 relative">
        <motion.div
          className="max-w-[1400px] mx-auto px-4 sm:px-6"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: { staggerChildren: 0.1 }
            }
          }}
        >

          {/* Top bar: Duration tabs + Balance */}
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 30 },
              visible: { opacity: 1, y: 0, transition: { type: 'spring', damping: 25, stiffness: 200 } }
            }}
            className="flex items-center justify-between gap-3 mb-6"
          >
            <div className="flex items-center gap-1.5 sm:gap-3 overflow-x-auto scrollbar-hide">
              <div className="flex items-center gap-2 mr-1 sm:mr-3 flex-shrink-0">
                <BitcoinIcon className="w-5 h-5 sm:w-7 sm:h-7" />
                <span className="text-base font-black uppercase tracking-tight text-white hidden sm:inline">BTC</span>
              </div>
              <Timer className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 hidden sm:block" />
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setSelectedDuration(opt.label)}
                  className={`px-2.5 sm:px-5 py-1.5 sm:py-2 rounded-lg text-[11px] sm:text-xs font-bold tracking-wide transition-all flex-shrink-0 ${selectedDuration === opt.label
                    ? 'bg-new-mint/15 text-new-mint border border-new-mint/30'
                    : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-white hover:bg-white/5'
                    }`}
                >
                  {opt.label.replace(' Minutes', 'm').replace(' Minute', 'm').replace(' Hour', 'h')}
                </button>
              ))}
            </div>

            {address && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <TokenBalance refreshTrigger={mintTrigger} />
              </div>
            )}
          </motion.div>

          {/* Scrolling ticker tape */}
          <div className="-mx-4 sm:-mx-6">
            <TickerTape />
          </div>

          {/* Faucet */}
          {address && (
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 30 },
                visible: { opacity: 1, y: 0, transition: { type: 'spring', damping: 25, stiffness: 200 } }
              }}
              className="mb-5"
            >
              <TokenFaucet onMinted={() => setMintTrigger(prev => prev + 1)} />
            </motion.div>
          )}

          {/* Two-column: Card + Sidebar */}
          <motion.div
            variants={{
              hidden: { opacity: 0, scale: 0.95 },
              visible: { opacity: 1, scale: 1, transition: { type: 'spring', damping: 25, stiffness: 200 } }
            }}
            className="flex gap-6"
          >
            {/* Main content */}
            <div className="flex-1 min-w-0">
              {/* Main Trading Card */}
              {loading ? (
                <div className="bg-neutral-900/50 border border-white/5 rounded-3xl p-12 text-center">
                  <Activity className="w-8 h-8 text-gray-600 mx-auto mb-3 animate-pulse" />
                  <p className="text-gray-500">Fetching rounds from chain...</p>
                </div>
              ) : roundMatchesTab && activeRound ? (
                <motion.div
                  key={activeRound.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <TradingCard
                    round={activeRound}
                    userYesDeposit={currentPosition?.yesDeposit || 0}
                    userNoDeposit={currentPosition?.noDeposit || 0}
                  />
                </motion.div>
              ) : (
                <WaitingState />
              )}

              {/* Mobile bet panel */}
              {roundMatchesTab && activeRound && (
                <div className="lg:hidden mt-5">
                  <BetSidebar round={activeRound} onSuccess={handleBetSuccess} />
                </div>
              )}

              {/* Bottom tab bar */}
              <div className="mt-8 flex items-center gap-1 border-b border-white/5 mb-4">
                {BOTTOM_TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setBottomTab(key)}
                    className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-4 py-2.5 text-[11px] sm:text-xs font-bold transition-all border-b-2 ${bottomTab === key
                      ? 'text-white border-new-mint'
                      : 'text-gray-500 border-transparent hover:text-gray-300'
                      }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Bottom tab content */}
              <div className="min-h-[200px]">
                {bottomTab === 'activity' && (
                  <RoundHistory
                    rounds={pastRounds}
                    positions={positions}
                    onClaim={handleClaim}
                  />
                )}

                {bottomTab === 'comments' && (
                  <Comments roundId={activeRound?.id || 0} />
                )}

                {bottomTab === 'stats' && (
                  <div className="space-y-4">
                    {address && positions.length > 0 ? (
                      <>
                        <PredictionStats rounds={pastRounds} positions={positions} />
                        <PnLChart rounds={pastRounds} positions={positions} />
                      </>
                    ) : (
                      <div className="text-center py-12">
                        <BarChart3 className="w-8 h-8 text-gray-600 mx-auto mb-3" />
                        <p className="text-gray-500 text-sm">
                          {address ? 'Place some bets to see your stats' : 'Connect wallet to see stats'}
                        </p>
                      </div>
                    )}

                    {/* BTC / Pool stats */}
                    {activeRound && (
                      <div className="bg-neutral-900/40 border border-white/5 rounded-xl p-4 space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-500">BTC 24h</span>
                          <span className={`text-xs font-mono font-bold ${change24h >= 0 ? 'text-new-mint' : 'text-off-red'}`}>
                            {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-500">Pool</span>
                          <span className="text-xs font-mono font-bold text-new-mint">
                            {formatPred(activeRound.totalPool)} USDCx
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-500">Fee</span>
                          <span className="text-xs font-bold text-gray-400">10%</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {bottomTab === 'rules' && (
                  <div className="bg-neutral-900/40 border border-white/5 rounded-xl p-5 space-y-4">
                    <h4 className="text-sm font-bold text-white">How it works</h4>
                    <div className="space-y-3 text-[13px] text-gray-400 leading-relaxed">
                      <p>
                        Each round sets a <span className="text-new-blue font-bold">target BTC price</span>.
                        Predict whether BTC will be at or above the target when the round ends.
                      </p>
                      <p>
                        Resolves <span className="text-new-mint font-bold">YES</span> if BTC price at round end
                        is greater than or equal to the target price. Otherwise resolves{' '}
                        <span className="text-off-red font-bold">NO</span>.
                      </p>
                      <p>
                        Winners split the pool proportionally (minus <span className="text-white font-bold">10% fee</span>).
                        Stake with <span className="text-white font-bold">USDCx stablecoin</span>.
                        Your bets are encrypted as private Aleo records.
                      </p>
                      <div className="border-t border-white/5 pt-3 space-y-2 text-xs text-gray-500">
                        <div className="flex justify-between">
                          <span>Platform fee</span>
                          <span className="text-white font-bold">10%</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Token</span>
                          <span className="text-white font-bold">USDCx</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Network</span>
                          <span className="text-white font-bold">Aleo Testnet</span>
                        </div>
                        <div className="border-t border-white/5 pt-2 mt-2 space-y-2">
                          <div className="flex justify-between items-center">
                            <span>Bet Privacy</span>
                            <span className="flex items-center gap-1 text-sky-400 font-bold"><Shield className="w-3 h-3" /> Encrypted</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Identity</span>
                            <span className="text-sky-400 font-bold">BHP256 Hashed</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Claims</span>
                            <span className="text-sky-400 font-bold">ZK-Verified</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* BTC News Feed — mobile */}
              <div className="lg:hidden">
                <NewsFeed />
              </div>
            </div>

            {/* Sidebar — bet panel + news (desktop only) */}
            {roundMatchesTab && activeRound && (
              <div className="hidden lg:block w-[340px] flex-shrink-0">
                <BetSidebar round={activeRound} onSuccess={handleBetSuccess} />
                <NewsFeed />
              </div>
            )}
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpen,
  History,
  MessageCircle,
  Shield,
  Timer,
  Trophy,
  XCircle,
} from 'lucide-react';
import Header from '@/components/Header';
import DoodleStrip from '@/components/DoodleStrip';
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
import BitcoinIcon from '@/components/icons/BitcoinIcon';
import NewsFeed from '@/components/NewsFeed';
import TickerTape from '@/components/TickerTape';

type BottomTab = 'activity' | 'comments' | 'stats' | 'rules';

export default function BtcMarketsPage() {
  const { address } = useWallet();
  const { change24h } = useBtcPrice();
  const { activeRound, pastRounds, positions, loading, reloadPositions, setActiveRound } = useRounds();

  const [mintTrigger, setMintTrigger] = useState(0);
  const [manualDuration, setManualDuration] = useState<DurationLabel | null>(null);
  const [notification, setNotification] = useState<{ type: 'win' | 'lose'; amount: number; roundId: number } | null>(null);
  const [bottomTab, setBottomTab] = useState<BottomTab>('comments');

  const matchedActiveDuration = activeRound
    ? DURATION_OPTIONS.find((d) => Math.abs(d.seconds - activeRound.durationMs / 1000) < 10)?.label
    : null;
  const selectedDuration = manualDuration ?? matchedActiveDuration ?? '5 Minutes';
  const durationMs = DURATION_OPTIONS.find((d) => d.label === selectedDuration)!.seconds * 1000;
  const roundMatchesTab = activeRound && Math.abs(activeRound.durationMs - durationMs) < 10_000;

  const prevRoundRef = useRef<{ id: number; resolved: boolean } | null>(null);
  useEffect(() => {
    if (!activeRound) {
      if (prevRoundRef.current && !prevRoundRef.current.resolved) {
        const resolved = pastRounds.find((r) => r.id === prevRoundRef.current!.id);
        if (resolved) {
          const currentPositions = loadPositions();
          const pos = currentPositions.find((p) => p.roundId === resolved.id);
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
  }, [activeRound, pastRounds]);

  const handleBetSuccess = () => {
    setMintTrigger((prev) => prev + 1);
    reloadPositions();
    if (activeRound) {
      fetchRound(activeRound.id).then((updated) => {
        if (updated) setActiveRound((prev) => (prev ? { ...updated, endTime: prev.endTime } : updated));
      });
    }
  };

  const handleClaim = (roundId: number) => {
    markClaimed(roundId);
    reloadPositions();
    setMintTrigger((prev) => prev + 1);
  };

  const currentPosition = activeRound
    ? positions.find((p) => p.roundId === activeRound.id)
    : undefined;

  const BOTTOM_TABS: { key: BottomTab; label: string; icon: typeof History }[] = [
    { key: 'activity', label: 'Activity', icon: History },
    { key: 'comments', label: 'Comments', icon: MessageCircle },
    { key: 'stats', label: 'Stats', icon: BarChart3 },
    { key: 'rules', label: 'Rules', icon: BookOpen },
  ];

  const resolvedRounds = pastRounds.filter((r) => r.resolved && r.outcome !== null);

  return (
    <div className="min-h-screen overflow-x-hidden selection:bg-white selection:text-black">
      <Header />

      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: 'spring', damping: 20 }}
            className="fixed left-1/2 top-20 z-[55] -translate-x-1/2"
          >
            <div
              className={`flex items-center gap-3 rounded-2xl border px-6 py-3.5 shadow-2xl backdrop-blur-xl ${
                notification.type === 'win'
                  ? 'border-new-mint/30 bg-new-mint/15 shadow-new-mint/10'
                  : 'border-off-red/30 bg-off-red/15 shadow-off-red/10'
              }`}
            >
              {notification.type === 'win' ? (
                <Trophy className="h-5 w-5 text-new-mint" />
              ) : (
                <XCircle className="h-5 w-5 text-off-red" />
              )}
              <div>
                <span className={`text-sm font-bold ${notification.type === 'win' ? 'text-new-mint' : 'text-off-red'}`}>
                  {notification.type === 'win' ? 'You Won!' : 'Round Lost'}
                </span>
                <span className="ml-2 text-xs text-gray-400">
                  Round #{notification.roundId} —{' '}
                  {notification.type === 'win'
                    ? `+${formatPred(notification.amount)} USDCx`
                    : `-${formatPred(notification.amount)} USDCx`}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <DoodleStrip />

      <main className="relative pb-12 pt-28">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[#050505]" />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom,rgba(255,255,255,0.02),transparent_38%)]" />
        <motion.div
          className="mx-auto max-w-[1400px] px-4 sm:px-6"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
          }}
        >
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0, transition: { type: 'spring', damping: 24, stiffness: 220 } },
            }}
            className="mb-6 flex items-center justify-between gap-3"
          >
            <div className="scrollbar-hide flex items-center gap-1.5 overflow-x-auto sm:gap-3">
              <Link
                href="/markets"
                className="mr-2 inline-flex flex-shrink-0 items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-300 transition-colors hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Link>
              <div className="mr-1 flex flex-shrink-0 items-center gap-2 sm:mr-3">
                <BitcoinIcon className="h-5 w-5 sm:h-7 sm:w-7" />
                <span className="hidden text-base font-black uppercase tracking-tight text-white sm:inline">BTC</span>
              </div>
              <Timer className="hidden h-3.5 w-3.5 flex-shrink-0 text-gray-500 sm:block" />
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setManualDuration(opt.label)}
                  className={`flex-shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold tracking-wide transition-all sm:px-5 sm:py-2 sm:text-xs ${
                    selectedDuration === opt.label
                      ? 'border border-new-mint/30 bg-new-mint/15 text-new-mint'
                      : 'border border-white/5 bg-white/[0.03] text-gray-500 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {opt.label.replace(' Minutes', 'm').replace(' Minute', 'm').replace(' Hour', 'h')}
                </button>
              ))}
            </div>

            {address && (
              <div className="flex flex-shrink-0 items-center gap-2">
                <TokenBalance refreshTrigger={mintTrigger} />
              </div>
            )}
          </motion.div>

          <div className="-mx-4 mb-5 sm:-mx-6">
            <TickerTape />
          </div>

          {address && (
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { type: 'spring', damping: 24, stiffness: 220 } },
              }}
              className="mb-5"
            >
              <TokenFaucet onMinted={() => setMintTrigger((prev) => prev + 1)} />
            </motion.div>
          )}

          <motion.div
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0, transition: { type: 'spring', damping: 24, stiffness: 220 } },
            }}
            className="flex gap-6"
          >
            <div className="min-w-0 flex-1">
              {loading ? (
                <div className="rounded-3xl border border-white/5 bg-neutral-900/50 p-12 text-center">
                  <Activity className="mx-auto mb-3 h-8 w-8 animate-pulse text-gray-600" />
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

              {roundMatchesTab && activeRound && (
                <div className="mt-5 lg:hidden">
                  <BetSidebar round={activeRound} onSuccess={handleBetSuccess} />
                </div>
              )}

              <div className="mb-4 mt-8 flex items-center gap-1 border-b border-white/5">
                {BOTTOM_TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setBottomTab(key)}
                    className={`flex items-center gap-1 px-2.5 py-2.5 text-[11px] font-bold transition-all sm:gap-1.5 sm:px-4 sm:text-xs ${
                      bottomTab === key
                        ? 'border-b-2 border-new-mint text-white'
                        : 'border-b-2 border-transparent text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="min-h-[200px]">
                {bottomTab === 'activity' && (
                  <RoundHistory rounds={resolvedRounds} positions={positions} onClaim={handleClaim} />
                )}

                {bottomTab === 'comments' && <Comments roundId={activeRound?.id || 0} />}

                {bottomTab === 'stats' && (
                  <div className="space-y-4">
                    {address && positions.length > 0 ? (
                      <>
                        <PredictionStats rounds={resolvedRounds} positions={positions} />
                        <PnLChart rounds={resolvedRounds} positions={positions} />
                      </>
                    ) : (
                      <div className="py-12 text-center">
                        <BarChart3 className="mx-auto mb-3 h-8 w-8 text-gray-600" />
                        <p className="text-sm text-gray-500">
                          {address ? 'Place some bets to see your stats' : 'Connect wallet to see stats'}
                        </p>
                      </div>
                    )}

                    {activeRound && (
                      <div className="space-y-3 rounded-xl border border-white/5 bg-neutral-900/40 p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">BTC 24h</span>
                          <span
                            className={`text-xs font-mono font-bold ${
                              change24h >= 0 ? 'text-new-mint' : 'text-off-red'
                            }`}
                          >
                            {change24h >= 0 ? '+' : ''}
                            {change24h.toFixed(2)}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">Pool</span>
                          <span className="text-xs font-mono font-bold text-new-mint">
                            {formatPred(activeRound.totalPool)} USDCx
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {bottomTab === 'rules' && (
                  <div className="space-y-4 rounded-xl border border-white/5 bg-neutral-900/40 p-5">
                    <h4 className="text-sm font-bold text-white">How it works</h4>
                    <div className="space-y-3 text-[13px] leading-relaxed text-gray-400">
                      <p>
                        Each round sets a <span className="font-bold text-new-blue">target BTC price</span>. Predict whether BTC
                        will be at or above the target when the round ends.
                      </p>
                      <p>
                        Resolves <span className="font-bold text-new-mint">YES</span> if BTC price at round end is greater than or
                        equal to the target price. Otherwise resolves <span className="font-bold text-off-red">NO</span>.
                      </p>
                      <p>
                        Winners split the pool proportionally. Stake with <span className="font-bold text-white">USDCx</span>.
                        Your bets are encrypted as private Aleo records.
                      </p>
                      <div className="space-y-2 border-t border-white/5 pt-3 text-xs text-gray-500">
                        <div className="flex justify-between">
                          <span>Token</span>
                          <span className="font-bold text-white">USDCx</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Network</span>
                          <span className="font-bold text-white">Aleo Testnet</span>
                        </div>
                        <div className="mt-2 space-y-2 border-t border-white/5 pt-2">
                          <div className="flex items-center justify-between">
                            <span>Bet Privacy</span>
                            <span className="flex items-center gap-1 font-bold text-sky-400">
                              <Shield className="h-3 w-3" />
                              Encrypted
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Claims</span>
                            <span className="font-bold text-sky-400">ZK-Verified</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:hidden">
                <NewsFeed />
              </div>
            </div>

            {roundMatchesTab && activeRound && (
              <div className="hidden w-[340px] flex-shrink-0 lg:block">
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

'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader, Wallet, Droplets, Check } from 'lucide-react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import {
  BTC_PREDICTION_PROGRAM,
  BTC_PREDICTION_ADDRESS,
  PRED_TOKEN_PROGRAM,
  PRED_MULTIPLIER,
  formatPred,
  calcOdds,
  estimateProb,
  getConfidenceLabel,
  fetchOnChainBalance,
  type RoundState,
} from '@/lib/predictionContract';
import { savePosition } from '@/lib/roundHelpers';
import AnimatedNumber from './AnimatedNumber';

const BALANCE_KEY = 'dart_balance';
const QUICK_AMOUNTS = [50, 100, 250, 500];

function MintButton() {
  const { publicKey, requestTransaction } = useWallet();
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');

  const handleMint = async () => {
    if (!publicKey || !requestTransaction || state === 'loading') return;
    setState('loading');
    try {
      const microAmount = 1000 * PRED_MULTIPLIER;
      await requestTransaction({
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [{
          program: PRED_TOKEN_PROGRAM,
          functionName: 'mint_public',
          inputs: [`${microAmount}u64`],
        }],
        fee: 2_000_000,
        feePrivate: false,
      });
      const cur = parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10);
      localStorage.setItem(BALANCE_KEY, String(cur + microAmount));
      setState('done');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('idle');
    }
  };

  return (
    <button
      onClick={handleMint}
      disabled={state === 'loading'}
      className="w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 bg-white/[0.04] border border-white/10 text-gray-400 hover:text-new-mint hover:bg-new-mint/10 hover:border-new-mint/20 transition-all disabled:opacity-50"
    >
      {state === 'loading' ? (
        <Loader className="w-3.5 h-3.5 animate-spin" />
      ) : state === 'done' ? (
        <Check className="w-3.5 h-3.5 text-new-mint" />
      ) : (
        <Droplets className="w-3.5 h-3.5 text-amber-400/70" />
      )}
      {state === 'done' ? 'Minted 1,000 DART!' : 'Mint 1,000 DART'}
    </button>
  );
}

interface BetSidebarProps {
  round: RoundState;
  onSuccess?: () => void;
}

export default function BetSidebar({ round, onSuccess }: BetSidebarProps) {
  const { publicKey, requestTransaction } = useWallet();
  const { price } = useBtcPrice();
  const [side, setSide] = useState<'YES' | 'NO'>('YES');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [balance, setBalance] = useState(0);
  const [minsLeft, setMinsLeft] = useState(0);
  const [flashType, setFlashType] = useState<'none' | 'YES' | 'NO'>('none');

  const targetUsd = round.targetPrice / 100;
  const microAmount = Math.floor(parseFloat(amount || '0') * PRED_MULTIPLIER);
  const totalPool = round.yesPool + round.noPool;

  // Dynamic odds from live BTC price + time remaining (Polymarket-style)
  const odds = (() => {
    if (price > 0 && minsLeft > 0) {
      const prob = estimateProb(price, targetUsd, minsLeft);
      const yesPct = Math.round(prob * 100);
      return { yes: Math.max(1, Math.min(99, yesPct)), no: Math.max(1, Math.min(99, 100 - yesPct)) };
    }
    // Fallback to pool-based if no price data
    return calcOdds(round.yesPool, round.noPool);
  })();

  // Track minutes remaining for probability
  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, round.endTime - Date.now());
      setMinsLeft(remaining / 60000);
    };
    tick();
    const interval = setInterval(tick, 5000);
    return () => clearInterval(interval);
  }, [round.endTime]);

  // Read balance — sync from chain on mount, then poll localStorage for fast updates
  useEffect(() => {
    if (publicKey) {
      fetchOnChainBalance(publicKey).then(setBalance).catch(() => {});
    }
    const read = () => setBalance(parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10));
    read();
    const interval = setInterval(read, 2000);
    return () => clearInterval(interval);
  }, [publicKey]);

  // Estimated payout — odds-based (Polymarket-style)
  const estPayout = (() => {
    if (!microAmount) return 0;
    const sideOdds = side === 'YES' ? odds.yes : odds.no;
    if (sideOdds <= 0 || sideOdds >= 100) return microAmount * 0.9;
    return (microAmount / (sideOdds / 100)) * 0.9;
  })();

  const handleQuickAdd = (val: number) => {
    const current = parseFloat(amount || '0');
    setAmount((current + val).toString());
  };

  const handleBet = async () => {
    if (!publicKey || !requestTransaction) {
      setError('Connect wallet first');
      return;
    }
    if (!microAmount || microAmount <= 0) {
      setError('Enter an amount');
      return;
    }
    if (microAmount > balance) {
      setError('Insufficient DART. Mint more tokens.');
      return;
    }

    setLoading(true);
    setError('');

    // Trigger intense visual feedback punch
    setFlashType(side);
    setTimeout(() => setFlashType('none'), 400);

    try {
      const sideVal = side === 'YES' ? 'true' : 'false';

      // Combined: transfer tokens + place bet in one transaction
      await requestTransaction({
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [
          {
            program: PRED_TOKEN_PROGRAM,
            functionName: 'transfer_public',
            inputs: [BTC_PREDICTION_ADDRESS, `${microAmount}u64`],
          },
          {
            program: BTC_PREDICTION_PROGRAM,
            functionName: 'bet',
            inputs: [`${round.id}u64`, `${microAmount}u64`, sideVal],
          },
        ],
        fee: 2_000_000,
        feePrivate: false,
      });

      const newBalance = Math.max(0, balance - microAmount);
      localStorage.setItem(BALANCE_KEY, String(newBalance));
      setBalance(newBalance);

      savePosition(round.id, side, microAmount);

      setAmount('');
      onSuccess?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      if (message.includes('NOT_GRANTED') || message.includes('Permission')) {
        setError('Transaction rejected');
      } else if (message.includes('Insufficient')) {
        setError('Insufficient DART. Mint more tokens.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const isYes = side === 'YES';

  return (
    <>
      <div className="bg-neutral-900/60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden lg:sticky lg:top-28">

        {/* Full screen intense bet flash */}
        {flashType !== 'none' && (
          <motion.div
            initial={{ opacity: 0.8, scale: 0.9 }}
            animate={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className={`fixed inset-0 z-50 pointer-events-none rounded-full blur-[150px]
              ${flashType === 'YES' ? 'bg-new-mint/30' : 'bg-off-red/30'}`}
          />
        )}
        {/* YES / NO toggle */}
        <div className="p-4 pb-0">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSide('YES')}
              className={`relative py-3.5 rounded-xl font-bold text-sm transition-all hover:brightness-110 active:scale-95 ${isYes
                ? 'text-new-mint brightness-125'
                : 'text-new-mint/70'
                }`}
              style={{ backgroundColor: '#1a3a2a' }}
            >
              <div className="flex items-center justify-center gap-2">
                <span>Up</span>
                <span className="font-mono">{odds.yes}%</span>
              </div>
            </button>

            <button
              onClick={() => setSide('NO')}
              className={`relative py-3.5 rounded-xl font-bold text-sm transition-all hover:brightness-110 active:scale-95 ${!isYes
                ? 'text-off-red brightness-125'
                : 'text-off-red/70'
                }`}
              style={{ backgroundColor: '#3a1a1e' }}
            >
              <div className="flex items-center justify-center gap-2">
                <span>Down</span>
                <span className="font-mono">{odds.no}%</span>
              </div>
            </button>
          </div>
        </div>

        {/* Amount section */}
        <div className="p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-gray-300">Amount</span>
            <span className="text-[11px] text-gray-500">
              Balance: <span className="font-mono text-gray-400">{formatPred(balance)}</span>
            </span>
          </div>

          {/* Amount input */}
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(''); }}
              placeholder="0"
              className="w-full bg-black/40 border border-white/10 rounded-xl pl-16 pr-4 py-3 text-lg sm:text-2xl font-mono font-bold text-white placeholder-gray-700 focus:border-white/20 focus:outline-none transition-all text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              step="1"
              min="0"
            />
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500 uppercase">
              DART
            </div>
          </div>

          {/* Quick-add buttons */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_AMOUNTS.map((qa) => (
              <button
                key={qa}
                onClick={() => handleQuickAdd(qa)}
                className="flex-1 min-w-[3.5rem] py-1.5 rounded-lg text-[11px] font-bold bg-white/[0.04] text-gray-400 border border-white/5 hover:bg-white/[0.08] hover:text-white transition-all"
              >
                +{qa}
              </button>
            ))}
            <button
              onClick={() => setAmount(formatPred(balance).replace(/,/g, ''))}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white/[0.04] text-gray-400 border border-white/5 hover:bg-white/[0.08] hover:text-white transition-all"
            >
              Max
            </button>
          </div>

          {estPayout > 0 && (
            <div className="flex justify-between items-center text-xs px-1 pt-1">
              <span className="text-gray-500">Est. payout</span>
              <div className="flex items-center gap-1 font-mono font-bold text-new-mint">
                <AnimatedNumber value={formatPred(estPayout)} />
                <span>DART</span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-off-red text-xs font-bold text-center animate-pulse">{error}</p>
          )}

          {/* Confidence meter */}
          {price > 0 && minsLeft > 0 && (
            (() => {
              const targetUsd = round.targetPrice / 100;
              const prob = estimateProb(price, targetUsd, minsLeft);
              const { label, color } = getConfidenceLabel(prob);
              const pct = Math.round(prob * 100);
              return (
                <div className="py-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Confidence</span>
                    <span className={`text-[11px] font-bold ${color}`}>{label}</span>
                  </div>
                  <div className="relative h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="absolute left-0 top-0 h-full bg-gradient-to-r from-off-red to-off-red/30 transition-all duration-700"
                      style={{ width: `${100 - pct}%` }}
                    />
                    <div
                      className="absolute right-0 top-0 h-full bg-gradient-to-l from-new-mint to-new-mint/30 transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="absolute left-1/2 top-0 w-px h-full bg-white/20" />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white bg-neutral-900 transition-all duration-700 z-10"
                      style={{ left: `calc(${pct}% - 5px)` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-off-red/60">NO</span>
                    <span className="text-[9px] text-new-mint/60">YES</span>
                  </div>
                </div>
              );
            })()
          )}

          {/* CTA button */}
          {publicKey ? (
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.95 }}
              animate={flashType !== 'none' ? {
                scale: [1, 0.9, 1.05, 1],
                filter: ['brightness(1)', 'brightness(1.5)', 'brightness(1)']
              } : {}}
              transition={{ duration: 0.3 }}
              onClick={handleBet}
              disabled={loading || !amount || parseFloat(amount) <= 0 || round.resolved}
              className="relative w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              style={{
                backgroundColor: isYes ? '#34D399' : '#F43F5E',
                color: isYes ? '#000' : '#fff',
                opacity: (loading || !amount || parseFloat(amount) <= 0 || round.resolved) ? 0.5 : 1,
              }}
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                `Buy ${isYes ? 'Up' : 'Down'}`
              )}
            </motion.button>
          ) : (
            <div className="w-full py-3.5 rounded-xl bg-white/[0.05] border border-white/10 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
              <Wallet className="w-4 h-4" />
              Connect wallet to bet
            </div>
          )}

          {/* Mint DART shortcut */}
          {publicKey && (
            <MintButton />
          )}
        </div>
      </div>
    </>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader, Wallet, Droplets, Shield, Lock, KeyRound } from 'lucide-react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import {
  BALANCE_KEY,
  BALANCE_UPDATED_EVENT,
  BTC_PREDICTION_PROGRAM,
  BTC_PREDICTION_VAULT,
  PRED_MULTIPLIER,
  formatPred,
  formatMultiplier,
  impliedProb,
  calcLockedPayout,
  fetchOnChainBalance,
  setOptimisticBalance,
  type RoundState,
} from '@/lib/predictionContract';
import { savePosition, saveBetCommitment } from '@/lib/roundHelpers';
import AnimatedNumber from './AnimatedNumber';
const QUICK_AMOUNTS = [50, 100, 250, 500];

/** Generate a random field element (253-bit) as salt. */
function generateSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  bytes[0] &= 0x1f;
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const bigint = BigInt('0x' + hex);
  return bigint.toString() + 'field';
}

function GetUSDCxButton() {
  return (
    <a
      href="https://usdcx.aleo.dev/"
      target="_blank"
      rel="noopener noreferrer"
      className="w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 bg-white/[0.04] border border-white/10 text-gray-400 hover:text-new-mint hover:bg-new-mint/10 hover:border-new-mint/20 transition-all"
    >
      <Droplets className="w-3.5 h-3.5 text-amber-400/70" />
      Bridge USDCx
    </a>
  );
}

interface BetSidebarProps {
  round: RoundState;
  onSuccess?: () => void;
}

export default function BetSidebar({ round, onSuccess }: BetSidebarProps) {
  const { address, executeTransaction, transactionStatus } = useWallet();
  const [side, setSide] = useState<'YES' | 'NO'>('YES');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [balance, setBalance] = useState(0);
  const [flashType, setFlashType] = useState<'none' | 'YES' | 'NO'>('none');

  // Check if user already bet on this round
  const [hasBet, setHasBet] = useState(false);
  useEffect(() => {
    if (!address) return;
    const positions: { roundId: number }[] = JSON.parse(localStorage.getItem('v10_positions') || '[]');
    setHasBet(positions.some(p => p.roundId === round.id));
  }, [address, round.id]);

  const microAmount = Math.floor(parseFloat(amount || '0') * PRED_MULTIPLIER);

  // Fixed odds from on-chain multipliers
  const yesMult = round.yesMult || 18500;
  const noMult = round.noMult || 21000;
  const yesProb = impliedProb(yesMult);
  const noProb = impliedProb(noMult);

  // Read balance
  useEffect(() => {
    if (address) {
      fetchOnChainBalance(address).then(setBalance).catch(() => {});
    }
    const read = () => setBalance(parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10));
    const handleBalanceUpdate = (event: Event) => {
      const next = (event as CustomEvent<{ balance?: number }>).detail?.balance;
      if (typeof next === 'number') {
        setBalance(next);
        return;
      }
      read();
    };
    read();
    window.addEventListener(BALANCE_UPDATED_EVENT, handleBalanceUpdate);
    const interval = address ? setInterval(() => {
      fetchOnChainBalance(address).then(setBalance).catch(() => read());
    }, 10_000) : null;
    return () => {
      window.removeEventListener(BALANCE_UPDATED_EVENT, handleBalanceUpdate);
      if (interval) clearInterval(interval);
    };
  }, [address]);

  // Locked payout from fixed odds
  const lockedPayout = (() => {
    if (!microAmount) return 0;
    const mult = side === 'YES' ? yesMult : noMult;
    return calcLockedPayout(microAmount, mult);
  })();

  const handleQuickAdd = (val: number) => {
    const current = parseFloat(amount || '0');
    setAmount((current + val).toString());
  };

  const handleBet = async () => {
    if (!address || !executeTransaction) {
      setError('Connect wallet first');
      return;
    }
    if (!microAmount || microAmount <= 0) {
      setError('Enter an amount');
      return;
    }
    if (microAmount > balance) {
      setError('Insufficient USDCx.');
      return;
    }

    setLoading(true);
    setError('');

    // Trigger intense visual feedback
    setFlashType(side);
    setTimeout(() => setFlashType('none'), 400);

    try {
      const sideVal = side === 'YES' ? 'true' : 'false';
      const salt = generateSalt();
      const mult = side === 'YES' ? yesMult : noMult;
      const payout = calcLockedPayout(microAmount, mult);

      // v10: Single atomic transaction — bet() calls transfer_public_as_signer internally
      const betInputs = [
        BTC_PREDICTION_VAULT,
        `${round.id}u64`,
        `${microAmount}u128`,
        sideVal,
        salt,
        `${payout}u128`,
      ];

      const betResult = await executeTransaction({
        program: BTC_PREDICTION_PROGRAM,
        function: 'bet',
        inputs: betInputs,
        fee: 2_000_000,
        privateFee: false,
      });

      // Save commitment locally
      const tempTxId = typeof betResult === 'string' ? betResult : (betResult as any)?.transactionId;
      saveBetCommitment(address, round.id, side, microAmount, payout, salt, tempTxId ?? undefined);

      // Background: poll for on-chain tx ID and update stored value
      if (tempTxId && transactionStatus) {
        (async () => {
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 10_000));
            try {
              const status = await transactionStatus(tempTxId);
              if (status?.transactionId && status.transactionId !== tempTxId) {
                saveBetCommitment(address!, round.id, side, microAmount, payout, salt, status.transactionId);
                break;
              }
              if (status?.status === 'failed' || status?.status === 'rejected') break;
            } catch { break; }
          }
        })();
      }

      const newBalance = Math.max(0, balance - microAmount);
      setOptimisticBalance(newBalance);
      setBalance(newBalance);

      savePosition(round.id, side, microAmount, payout);
      setHasBet(true);

      setAmount('');
      onSuccess?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      if (message.includes('NOT_GRANTED') || message.includes('Permission')) {
        setError('Transaction rejected');
      } else if (message.includes('Insufficient')) {
        setError('Insufficient USDCx.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const isYes = side === 'YES';

  // Show active bet info if already bet on this round
  if (address && hasBet) {
    return (
      <div className="bg-neutral-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-5">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mx-auto">
            <KeyRound className="w-6 h-6 text-sky-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Bet Placed on Round #{round.id}</p>
            <p className="text-xs text-gray-400 mt-1">
              Your receipt is stored on-chain. Claim or forfeit after resolution.
            </p>
          </div>
          <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded-xl px-3 py-2">
            <Shield className="w-3 h-3 text-sky-400" />
            <span className="text-[10px] text-gray-400">
              Fixed payout locked at bet time — guaranteed if you win
            </span>
          </div>
        </div>
      </div>
    );
  }

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
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-2">
                  <span>Up</span>
                  <span className="font-mono">{formatMultiplier(yesMult)}</span>
                </div>
                <span className="text-[10px] opacity-60">{yesProb}% implied</span>
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
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-2">
                  <span>Down</span>
                  <span className="font-mono">{formatMultiplier(noMult)}</span>
                </div>
                <span className="text-[10px] opacity-60">{noProb}% implied</span>
              </div>
            </button>
          </div>
        </div>

        {/* Fixed odds indicator */}
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded-xl px-3 py-2">
            <div className="relative">
              <Lock className="w-3 h-3 text-sky-400" />
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-sky-400 rounded-full animate-pulse" />
            </div>
            <span className="text-[10px] text-sky-400/80 font-medium">Fixed Odds</span>
            <span className="text-[10px] text-gray-600">·</span>
            <span className="text-[10px] text-gray-500">Payout locked at bet time</span>
            <span className="text-[10px] text-gray-600">·</span>
            <span className="text-[10px] text-gray-500 font-mono">{formatPred(round.totalPool)} staked</span>
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
              USDCx
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

          {lockedPayout > 0 && (
            <div className="flex justify-between items-center text-xs px-1 pt-1">
              <span className="text-gray-500">Locked payout</span>
              <div className="flex items-center gap-1 font-mono font-bold text-new-mint">
                <AnimatedNumber value={formatPred(lockedPayout)} />
                <span>USDCx</span>
              </div>
            </div>
          )}

          {/* Privacy explainer */}
          <div className="flex items-start gap-2 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2">
            <Shield className="w-3 h-3 text-gray-600 mt-0.5 flex-shrink-0" />
            <span className="text-[10px] text-gray-600 leading-relaxed">
              Atomic escrow — your stake is locked in one transaction. Payout is fixed at bet time. No two-step approval needed.
            </span>
          </div>

          {/* Error */}
          {error && (
            <p className="text-off-red text-xs font-bold text-center animate-pulse">{error}</p>
          )}

          {/* CTA button */}
          {address ? (
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
                  Placing Bet...
                </>
              ) : (
                <>
                  <Shield className="w-3.5 h-3.5" />
                  {`Buy ${isYes ? 'Up' : 'Down'}`}
                </>
              )}
            </motion.button>
          ) : (
            <div className="w-full py-3.5 rounded-xl bg-white/[0.05] border border-white/10 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
              <Wallet className="w-4 h-4" />
              Connect wallet to bet
            </div>
          )}

          {/* Get USDCx shortcut */}
          {address && (
            <GetUSDCxButton />
          )}
        </div>
      </div>
    </>
  );
}

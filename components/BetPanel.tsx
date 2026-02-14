'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Loader, Wallet } from 'lucide-react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import {
  BTC_PREDICTION_PROGRAM,
  PRED_MULTIPLIER,
  formatPred,
  calcOdds,
  estimateProb,
  getConfidenceLabel,
  type RoundState,
} from '@/lib/predictionContract';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';

const BALANCE_KEY = 'dart_balance';

interface BetPanelProps {
  round: RoundState;
  onSuccess?: () => void;
}

const QUICK_AMOUNTS = [50, 100, 250, 500];

export default function BetPanel({ round, onSuccess }: BetPanelProps) {
  const { publicKey, requestTransaction } = useWallet();
  const { price } = useBtcPrice();
  const [side, setSide] = useState<'YES' | 'NO'>('YES');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [balance, setBalance] = useState(0);
  const [minsLeft, setMinsLeft] = useState(0);

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

  const odds = calcOdds(round.yesPool, round.noPool);
  const microAmount = Math.floor(parseFloat(amount || '0') * PRED_MULTIPLIER);

  const yesPrice = odds.yes;
  const noPrice = odds.no;

  // Read balance from localStorage
  useEffect(() => {
    const read = () => {
      setBalance(parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10));
    };
    read();
    const interval = setInterval(read, 2000);
    return () => clearInterval(interval);
  }, []);

  // Estimate payout if this bet wins
  const estPayout = (() => {
    if (!microAmount) return 0;
    const totalPool = round.yesPool + round.noPool + microAmount;
    const winPool = (side === 'YES' ? round.yesPool : round.noPool) + microAmount;
    return (microAmount / winPool) * totalPool * 0.9;
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

    try {
      const betFunction = side === 'YES' ? 'bet_yes' : 'bet_no';

      const transaction = {
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [
          {
            program: BTC_PREDICTION_PROGRAM,
            functionName: betFunction,
            inputs: [`${round.id}u64`, `${microAmount}u64`],
          },
        ],
        fee: 500000,
        feePrivate: false,
      };

      await requestTransaction(transaction);

      // Deduct from local balance tracker
      const newBalance = Math.max(0, balance - microAmount);
      localStorage.setItem(BALANCE_KEY, String(newBalance));
      setBalance(newBalance);

      // Save position
      const positions = JSON.parse(localStorage.getItem('pred_positions') || '[]');
      positions.push({
        roundId: round.id,
        side,
        amount: microAmount,
        timestamp: Date.now(),
      });
      localStorage.setItem('pred_positions', JSON.stringify(positions));

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
    <div className="bg-neutral-900/60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
      {/* YES / NO toggle */}
      <div className="p-4 pb-0">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSide('YES')}
            className={`relative py-3 rounded-xl font-bold text-sm transition-all ${
              isYes
                ? 'bg-new-mint/20 text-new-mint border-2 border-new-mint/40'
                : 'bg-white/[0.03] text-gray-500 border-2 border-transparent hover:bg-white/5 hover:text-gray-300'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span>Yes</span>
              <span className="font-mono">{yesPrice}%</span>
            </div>
          </button>

          <button
            onClick={() => setSide('NO')}
            className={`relative py-3 rounded-xl font-bold text-sm transition-all ${
              !isYes
                ? 'bg-off-red/20 text-off-red border-2 border-off-red/40'
                : 'bg-white/[0.03] text-gray-500 border-2 border-transparent hover:bg-white/5 hover:text-gray-300'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <TrendingDown className="w-4 h-4" />
              <span>No</span>
              <span className="font-mono">{noPrice}%</span>
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
            className="w-full bg-black/40 border border-white/10 rounded-xl pl-4 pr-16 py-3.5 text-2xl font-mono font-bold text-white placeholder-gray-700 focus:border-white/20 focus:outline-none transition-all text-right"
            step="1"
            min="0"
          />
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500 uppercase">
            DART
          </div>
        </div>

        {/* Quick-add buttons */}
        <div className="flex gap-1.5">
          {QUICK_AMOUNTS.map((qa) => (
            <button
              key={qa}
              onClick={() => handleQuickAdd(qa)}
              className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-white/[0.04] text-gray-400 border border-white/5 hover:bg-white/[0.08] hover:text-white transition-all"
            >
              +{qa}
            </button>
          ))}
          <button
            onClick={() => setAmount(formatPred(balance).replace(/,/g, ''))}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/[0.04] text-gray-400 border border-white/5 hover:bg-white/[0.08] hover:text-white transition-all"
          >
            Max
          </button>
        </div>

        {/* Payout estimate */}
        {estPayout > 0 && (
          <div className="flex justify-between items-center text-xs px-1 pt-1">
            <span className="text-gray-500">Est. payout</span>
            <span className="font-mono font-bold text-new-mint">{formatPred(estPayout)} DART</span>
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
                  {/* NO side (red from left) */}
                  <div
                    className="absolute left-0 top-0 h-full bg-gradient-to-r from-off-red to-off-red/30 transition-all duration-700"
                    style={{ width: `${100 - pct}%` }}
                  />
                  {/* YES side (green from right) */}
                  <div
                    className="absolute right-0 top-0 h-full bg-gradient-to-l from-new-mint to-new-mint/30 transition-all duration-700"
                    style={{ width: `${pct}%` }}
                  />
                  {/* Center marker */}
                  <div className="absolute left-1/2 top-0 w-px h-full bg-white/20" />
                  {/* Position indicator */}
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
            whileTap={{ scale: 0.98 }}
            onClick={handleBet}
            disabled={loading || !amount || parseFloat(amount) <= 0 || round.resolved}
            className={`w-full py-3.5 rounded-xl font-bold text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
              isYes
                ? 'bg-new-mint text-black shadow-[0_0_20px_rgba(52,211,153,0.2)] hover:shadow-[0_0_30px_rgba(52,211,153,0.3)]'
                : 'bg-off-red text-white shadow-[0_0_20px_rgba(244,63,94,0.2)] hover:shadow-[0_0_30px_rgba(244,63,94,0.3)]'
            }`}
          >
            {loading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              `Buy ${isYes ? 'Yes' : 'No'}`
            )}
          </motion.button>
        ) : (
          <div className="w-full py-3.5 rounded-xl bg-white/[0.05] border border-white/10 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
            <Wallet className="w-4 h-4" />
            Connect wallet to bet
          </div>
        )}
      </div>
    </div>
  );
}

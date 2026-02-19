'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, Activity, Loader } from 'lucide-react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import {
  BTC_PREDICTION_PROGRAM,
  BTC_PREDICTION_ADDRESS,
  PRED_TOKEN_PROGRAM,
  PRED_MULTIPLIER,
  formatPred,
  estimateProb,
  type RoundState,
} from '@/lib/predictionContract';

interface QuickBetProps {
  round: RoundState;
  side: 'YES' | 'NO';
  onClose: () => void;
  onSuccess?: () => void;
}

const QUICK_AMOUNTS = [50, 100, 250, 500];

export default function QuickBet({ round, side, onClose, onSuccess }: QuickBetProps) {
  const { publicKey, requestTransaction } = useWallet();
  const { price } = useBtcPrice();
  const [amount, setAmount] = useState('100');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const microAmount = Math.floor(parseFloat(amount || '0') * PRED_MULTIPLIER);

  const odds = useMemo(() => {
    const targetUsd = round.targetPrice / 100;
    const minsLeft = Math.max(0, (round.endTime - Date.now()) / 60000);
    if (price > 0 && minsLeft > 0) {
      const prob = estimateProb(price, targetUsd, minsLeft);
      const yesPct = Math.round(prob * 100);
      return { yes: Math.max(1, Math.min(99, yesPct)), no: Math.max(1, Math.min(99, 100 - yesPct)) };
    }
    return { yes: 50, no: 50 };
  }, [price, round.targetPrice, round.endTime]);

  // Estimate payout if this bet wins
  const estPayout = (() => {
    if (!microAmount) return 0;
    const totalPool = round.yesPool + round.noPool + microAmount;
    const winPool = (side === 'YES' ? round.yesPool : round.noPool) + microAmount;
    return (microAmount / winPool) * totalPool * 0.9;
  })();

  const handleBet = async () => {
    if (!publicKey || !requestTransaction) {
      setError('Connect your wallet first');
      return;
    }

    if (!microAmount || microAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Step 1: Transfer DART tokens to the prediction program (public transfer)
      // Step 2: Place the bet
      const betFunction = side === 'YES' ? 'bet_yes' : 'bet_no';

      // Step 1: Transfer DART tokens to the prediction program
      await requestTransaction({
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [{
          program: PRED_TOKEN_PROGRAM,
          functionName: 'transfer_public',
          inputs: [BTC_PREDICTION_ADDRESS, `${microAmount}u64`],
        }],
        fee: 2_000_000,
        feePrivate: false,
      });

      // Step 2: Place the bet
      await requestTransaction({
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [{
          program: BTC_PREDICTION_PROGRAM,
          functionName: betFunction,
          inputs: [`${round.id}u64`, `${microAmount}u64`],
        }],
        fee: 2_000_000,
        feePrivate: false,
      });

      // Save position to localStorage
      const positions = JSON.parse(localStorage.getItem('pred_positions') || '[]');
      positions.push({
        roundId: round.id,
        side,
        amount: microAmount,
        timestamp: Date.now(),
        txPending: true,
      });
      localStorage.setItem('pred_positions', JSON.stringify(positions));

      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      if (message.includes('NOT_GRANTED') || message.includes('Permission')) {
        setError('Transaction rejected by wallet');
      } else if (message.includes('Insufficient')) {
        setError('Insufficient DART balance. Mint more tokens.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="relative w-full max-w-md"
        >
          {/* Background */}
          <div className="absolute inset-0 bg-neutral-900/90 backdrop-blur-2xl border border-white/10 rounded-3xl" />
          <div className={`absolute -top-24 -right-24 w-64 h-64 blur-[80px] rounded-full pointer-events-none ${side === 'YES' ? 'bg-new-mint/20' : 'bg-off-red/20'}`} />

          <div className="relative p-8">
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tight text-white mb-1">
                  Bet {side}
                </h2>
                <p className="text-gray-500 text-xs font-mono">
                  Round #{round.id} — Target ${(round.targetPrice / 100).toFixed(2)}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Side indicator */}
            <div className={`mb-6 p-4 rounded-2xl border ${side === 'YES' ? 'border-new-mint/30 bg-new-mint/5' : 'border-off-red/30 bg-off-red/5'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {side === 'YES' ? (
                    <TrendingUp className="w-6 h-6 text-new-mint" />
                  ) : (
                    <Activity className="w-6 h-6 text-off-red" />
                  )}
                  <div>
                    <span className={`text-2xl font-black ${side === 'YES' ? 'text-new-mint' : 'text-off-red'}`}>
                      {side}
                    </span>
                    <span className="block text-[10px] text-gray-500 uppercase tracking-widest">
                      BTC {side === 'YES' ? '>=' : '<'} Target
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-mono font-bold text-white">
                    {side === 'YES' ? odds.yes : odds.no}%
                  </span>
                  <span className="block text-[10px] text-gray-500 uppercase tracking-widest">odds</span>
                </div>
              </div>
            </div>

            {/* Quick amounts */}
            <div className="flex gap-2 mb-4">
              {QUICK_AMOUNTS.map((qa) => (
                <button
                  key={qa}
                  onClick={() => setAmount(qa.toString())}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                    amount === qa.toString()
                      ? 'bg-white/10 text-white border border-white/20'
                      : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {qa}
                </button>
              ))}
            </div>

            {/* Amount input */}
            <div className="mb-6">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">
                Amount (DART)
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-xl font-mono font-bold text-white placeholder-gray-700 focus:border-white/30 focus:outline-none focus:ring-4 focus:ring-white/5 transition-all"
                  step="1"
                  min="0"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500">
                  DART
                </div>
              </div>
            </div>

            {/* Payout estimate */}
            {estPayout > 0 && (
              <div className="flex justify-between items-center text-xs px-2 mb-4">
                <span className="text-gray-500">Est. Payout (if {side} wins)</span>
                <span className="font-mono font-bold text-new-mint">{formatPred(estPayout)} DART</span>
              </div>
            )}

            {/* Error */}
            {error && (
              <p className="text-off-red text-xs font-bold text-center mb-4 animate-pulse">
                {error}
              </p>
            )}

            {/* Submit button */}
            <button
              onClick={handleBet}
              disabled={loading || !amount || parseFloat(amount) <= 0}
              className={`w-full py-4 rounded-xl font-bold uppercase tracking-widest text-sm transition-all shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                side === 'YES'
                  ? 'bg-new-mint text-black shadow-[0_0_30px_rgba(52,211,153,0.3)]'
                  : 'bg-off-red text-black shadow-[0_0_30px_rgba(244,63,94,0.3)]'
              }`}
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                `Confirm ${side}`
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

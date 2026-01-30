'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, AlertCircle } from 'lucide-react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import IncognitoToggle from './IncognitoToggle';
import type { Market } from './MarketCard';
import { savePosition } from '@/lib/positionStorage';

interface BetModalProps {
  market: Market;
  side: 'YES' | 'NO';
  onClose: () => void;
}

export default function BetModal({ market, side, onClose }: BetModalProps) {
  const { publicKey, requestTransaction } = useWallet();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'public' | 'private'>('public');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Calculate estimated shares
  const calculateShares = () => {
    if (!amount || isNaN(parseFloat(amount))) return 0;
    const betAmount = parseFloat(amount);

    const total = market.total_yes_shares + market.total_no_shares + 1;
    const sideShares = side === 'YES' ? market.total_yes_shares : market.total_no_shares;

    // Simplified AMM calculation
    return (betAmount * total) / (sideShares + 1);
  };

  const estimatedShares = calculateShares();
  const estimatedOdds = side === 'YES'
    ? (market.total_yes_shares / (market.total_yes_shares + market.total_no_shares || 1)) * 100
    : (market.total_no_shares / (market.total_yes_shares + market.total_no_shares || 1)) * 100;

  const handlePlaceBet = async () => {
    if (!publicKey || !requestTransaction) {
      setError('Please connect your wallet first');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Call appropriate Leo transition based on mode
      const transition = mode === 'private' ? 'buy_shares_private' : 'buy_shares_public';

      // Convert amount to microcredits (1 ALEO = 1,000,000 microcredits)
      const amountInMicrocredits = Math.floor(parseFloat(amount) * 1_000_000);

      const inputs = [
        `${market.id}u64`,                    // market_id: u64
        side === 'YES' ? 'true' : 'false',    // side: bool
        `${amountInMicrocredits}u64`,         // amount: u64
      ];

      // Construct proper AleoTransaction object
      const transaction = {
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [{
          program: 'predictionmarket_v2.aleo',
          functionName: transition,
          inputs,
        }],
        fee: 1000000, // 1 million microcredits = 1 ALEO
        feePrivate: false,
      };

      const txResult = await requestTransaction(transaction);

      console.log('Transaction result:', txResult);

      // Save position locally (since Aleo positions are private records)
      const currentPrice = market.total_yes_shares && market.total_no_shares
        ? side === 'YES'
          ? market.total_yes_shares / (market.total_yes_shares + market.total_no_shares)
          : market.total_no_shares / (market.total_yes_shares + market.total_no_shares)
        : 0.5;

      savePosition({
        marketId: market.id.toString(),
        question: market.question,
        side,
        shares: parseFloat(amount),
        entryPrice: currentPrice,
        timestamp: Date.now(),
        txHash: typeof txResult === 'string' ? txResult : undefined,
        userAddress: publicKey,
      });

      // Success!
      alert(`Bet placed successfully! ${mode === 'private' ? '🕵️ Your bet is private' : '👁️ Your bet is public'}`);
      onClose();
    } catch (err: any) {
      // Better error messages for common issues
      let errorMessage = 'Transaction failed';

      if (err.message?.includes('NOT_GRANTED') || err.message?.includes('Permission Not Granted')) {
        errorMessage = 'Transaction rejected. Please approve in your wallet and ensure sufficient balance.';
      } else if (err.message?.includes('Insufficient')) {
        errorMessage = 'Insufficient balance. You need more ALEO to place this bet.';
      } else if (err.message?.includes('timeout')) {
        errorMessage = 'Transaction timed out. Please try again.';
      } else if (err.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">

        {/* Modal Window */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="relative w-full max-w-md overflow-hidden"
        >
          {/* Background Layers */}
          <div className="absolute inset-0 bg-neutral-900/80 backdrop-blur-2xl border border-white/10 rounded-3xl" />
          <div className="absolute inset-0 bg-noise opacity-30 mix-blend-overlay pointer-events-none rounded-3xl" />
          <div className="absolute -top-24 -right-24 w-64 h-64 bg-off-blue/20 blur-[80px] rounded-full pointer-events-none" />
          <div className={`absolute -bottom-24 -left-24 w-64 h-64 blur-[80px] rounded-full pointer-events-none ${side === 'YES' ? 'bg-off-green/10' : 'bg-off-red/10'}`} />

          {/* Content */}
          <div className="relative p-8 px-8">

            {/* Header */}
            <div className="flex justify-between items-start mb-8">
              <div>
                <h2 className="text-3xl font-black uppercase tracking-tight text-white mb-2">Place Bet</h2>
                <p className="text-gray-400 text-xs font-mono line-clamp-1 max-w-[240px]">{market.question}</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 -mr-2 -mt-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Side Selection Indicator */}
            <div className={`mb-8 p-1 rounded-2xl border ${side === 'YES' ? 'border-off-green/30 bg-off-green/5' : 'border-off-red/30 bg-off-red/5'}`}>
              <div className="relative overflow-hidden rounded-xl bg-neutral-950/50 p-5 flex items-center justify-between">
                <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay" />
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Position</span>
                  <span className={`text-3xl font-black uppercase italic tracking-tighter ${side === 'YES' ? 'text-off-green' : 'text-off-red'}`}>
                    {side}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">Odds</span>
                  <span className="text-xl font-mono font-bold text-white">
                    {estimatedOdds.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Input Field */}
            <div className="mb-8">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-3">
                Amount (Credits)
              </label>
              <div className="relative group">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-xl font-mono font-bold text-white placeholder-gray-700 focus:border-white/30 focus:bg-black/60 focus:outline-none focus:ring-4 focus:ring-white/5 transition-all"
                  step="0.01"
                  min="0"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500 pointer-events-none">
                  ALEO
                </div>
              </div>
            </div>

            {/* Privacy Toggle */}
            <div className="mb-8">
              <IncognitoToggle mode={mode} onChange={setMode} />
            </div>

            {/* Information & Actions */}
            <div className="space-y-4">
              {estimatedShares > 0 && (
                <div className="flex justify-between items-center text-xs px-2">
                  <span className="text-gray-500">Est. Shares</span>
                  <span className="font-mono text-white">{estimatedShares.toFixed(2)}</span>
                </div>
              )}

              {error && (
                <p className="text-off-red text-xs font-bold text-center animate-pulse">
                  {error}
                </p>
              )}

              <button
                onClick={handlePlaceBet}
                disabled={loading || !amount}
                className={`w-full py-4 rounded-xl font-bold uppercase tracking-widest text-sm transition-all shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
                  ${side === 'YES'
                    ? 'bg-off-green text-black shadow-[0_0_30px_rgba(52,211,153,0.3)] hover:shadow-[0_0_50px_rgba(52,211,153,0.5)]'
                    : 'bg-off-red text-black shadow-[0_0_30px_rgba(244,63,94,0.3)] hover:shadow-[0_0_50px_rgba(244,63,94,0.5)]'}
                `}
              >
                {loading ? 'Processing...' : `Confirm ${side}`}
              </button>
            </div>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

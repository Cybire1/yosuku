'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { formatStrike } from '@/lib/roundHelpers';
import type { FeeBreakdown } from '@/lib/sui/sviPricing';
import Countdown from './Countdown';

type Side = 'UP' | 'DOWN' | 'RANGE';

interface TradeConfirmationModalProps {
  side: Side;
  asset: string;
  strike: number;
  upperStrike?: number | null;
  amount: number; // micro DUSDC
  fairPrice: number | null; // 0-1
  feeBreakdown: FeeBreakdown | null;
  onChainCost?: number | null; // exact DUSDC from get_trade_amounts (UP/DOWN only)
  expiry: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const sideConfig = {
  UP: { label: 'Up', icon: TrendingUp, color: 'emerald', bgClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', btnClass: 'bg-emerald-500 hover:bg-emerald-400 text-black' },
  DOWN: { label: 'Down', icon: TrendingDown, color: 'rose', bgClass: 'bg-rose-500/10 text-rose-400 border-rose-500/20', btnClass: 'bg-rose-500 hover:bg-rose-400 text-white' },
  RANGE: { label: 'Range', icon: Activity, color: 'amber', bgClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20', btnClass: 'bg-amber-500 hover:bg-amber-400 text-black' },
};

export default function TradeConfirmationModal({
  side,
  asset,
  strike,
  upperStrike,
  amount,
  fairPrice,
  feeBreakdown,
  onChainCost,
  expiry,
  onConfirm,
  onCancel,
}: TradeConfirmationModalProps) {
  const config = sideConfig[side];
  const SideIcon = config.icon;
  const amountDisplay = (amount / DUSDC_MULTIPLIER).toFixed(2);
  const strikeDollars = strike / FLOAT_SCALING;
  const upperStrikeDollars = upperStrike ? upperStrike / FLOAT_SCALING : 0;

  // Max payout for binary: 1 DUSDC per unit
  const maxPayout = amount / DUSDC_MULTIPLIER;
  // Prefer the exact on-chain cost; fall back to the SVI estimate.
  const hasExact = typeof onChainCost === 'number' && onChainCost > 0;
  const totalCost = hasExact
    ? (onChainCost as number)
    : feeBreakdown
      ? feeBreakdown.totalCostPerUnit * maxPayout
      : parseFloat(amountDisplay);
  const potentialProfit = maxPayout - totalCost;

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4"
        onClick={onCancel}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm bg-neutral-900/95 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h3 className="font-display font-bold text-lg text-white">Confirm Trade</h3>
            <button
              onClick={onCancel}
              className="p-1 text-gray-500 hover:text-white transition-colors rounded-lg hover:bg-white/5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-5 pb-5 space-y-4">
            {/* Direction badge */}
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${config.bgClass}`}>
              <SideIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-bold uppercase tracking-wider">
                {side === 'RANGE' ? 'Range' : `${asset} ${config.label}`}
              </span>
            </div>

            {/* Key details */}
            <div className="space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Strike</span>
                <span className="text-white font-mono font-bold">
                  {side === 'RANGE' && upperStrike
                    ? `$${strikeDollars.toLocaleString()} — $${upperStrikeDollars.toLocaleString()}`
                    : `$${strikeDollars.toLocaleString()}`}
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Amount</span>
                <span className="text-white font-mono font-bold">{amountDisplay} DUSDC</span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Expires</span>
                <span className="text-white">
                  <Countdown expiryMs={expiry} className="text-sm" />
                </span>
              </div>
            </div>

            {/* Fee breakdown */}
            {feeBreakdown && (
              <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Fair Price</span>
                  <span className="text-white font-mono">{(feeBreakdown.fairPrice * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Bernoulli Fee</span>
                  <span className="text-gray-400 font-mono">{(feeBreakdown.bernoulliFee * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Utilization Fee</span>
                  <span className="text-gray-400 font-mono">{(feeBreakdown.utilizationFee * 100).toFixed(2)}%</span>
                </div>
                <div className="border-t border-white/5 pt-2 flex justify-between text-xs">
                  <span className="text-gray-500">Total Cost / Unit</span>
                  <span className="text-white font-mono font-semibold">{(feeBreakdown.totalCostPerUnit * 100).toFixed(2)}%</span>
                </div>
              </div>
            )}

            {/* Payout summary */}
            <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Max Payout</span>
                <span className="text-white font-mono font-bold">{maxPayout.toFixed(2)} DUSDC</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500 inline-flex items-center gap-1.5">
                  {hasExact ? 'Cost' : 'Est. Cost'}
                  {hasExact && (
                    <span className="text-[8px] font-bold uppercase tracking-wider text-vermilion/80 bg-vermilion/10 px-1 py-0.5 rounded">on-chain</span>
                  )}
                </span>
                <span className="text-white font-mono">{totalCost.toFixed(hasExact ? 4 : 2)} DUSDC</span>
              </div>
              <div className="border-t border-white/5 pt-2 flex justify-between text-xs">
                <span className="text-gray-500">Potential Profit</span>
                <span className="text-emerald-400 font-mono font-bold">+{potentialProfit.toFixed(2)} DUSDC</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={onCancel}
                className="flex-1 py-3 rounded-xl text-sm font-bold uppercase tracking-wider border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className={`flex-1 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all ${config.btnClass}`}
              >
                Confirm
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// @ts-nocheck
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader, Wallet, Droplets } from 'lucide-react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { useDUSDCBalance } from '@/lib/sui/hooks';
import { useManager } from '@/lib/sui/hooks';
import { depositAndMintTx, createManagerTx } from '@/lib/sui/predictClient';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import {
  formatPred,
  estimateProb,
  getConfidenceLabel,
  type RoundState,
} from '@/lib/predictionContract';
import { defaultStrike, savePosition, generateDisplayStrikeGrid, formatStrike } from '@/lib/roundHelpers';
import AnimatedNumber from './AnimatedNumber';

const QUICK_AMOUNTS = [50, 100, 250, 500];

function GetDUSDCButton() {
  return (
    <a
      href="https://faucet.testnet.sui.io/"
      target="_blank"
      rel="noopener noreferrer"
      className="w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 bg-white/[0.04] border border-white/10 text-gray-400 hover:text-new-mint hover:bg-new-mint/10 hover:border-new-mint/20 transition-all"
    >
      <Droplets className="w-3.5 h-3.5 text-amber-400/70" />
      Get Test DUSDC
    </a>
  );
}

interface BetSidebarProps {
  round: RoundState;
  onSuccess?: () => void;
}

export default function BetSidebar({ round, onSuccess }: BetSidebarProps) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { price } = useBtcPrice();
  const { balance, coins, refresh: refreshBalance } = useDUSDCBalance();
  const { manager, refresh: refreshManager } = useManager();

  const [direction, setDirection] = useState<'UP' | 'DOWN'>('UP');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [minsLeft, setMinsLeft] = useState(0);
  const [flashType, setFlashType] = useState<'none' | 'UP' | 'DOWN'>('none');
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);

  // Generate a curated strike grid centered around current price.
  const centerPrice = price ? price * FLOAT_SCALING : undefined;
  const strikes = generateDisplayStrikeGrid(round.minStrike, round.tickSize, 21, centerPrice);

  // Auto-select the app default line, not every raw protocol tick.
  useEffect(() => {
    if (selectedStrike === null && strikes.length > 0) {
      if (centerPrice) {
        setSelectedStrike(defaultStrike(centerPrice, round.minStrike, round.tickSize));
      } else {
        setSelectedStrike(strikes[Math.floor(strikes.length / 2)]);
      }
    }
  }, [strikes, selectedStrike, centerPrice]);

  const microAmount = Math.floor(parseFloat(amount || '0') * DUSDC_MULTIPLIER);

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

  // Dynamic odds from live BTC price + time remaining
  const odds = (() => {
    if (price > 0 && minsLeft > 0 && selectedStrike) {
      const targetUsd = selectedStrike / FLOAT_SCALING;
      const prob = estimateProb(price, targetUsd, minsLeft);
      const upPct = Math.round(prob * 100);
      return { up: Math.max(1, Math.min(99, upPct)), down: Math.max(1, Math.min(99, 100 - upPct)) };
    }
    return { up: 50, down: 50 };
  })();

  const estPayout = (() => {
    if (!microAmount) return 0;
    // Quantity = amount in micro DUSDC (1 contract = $1)
    // Win payout = quantity (full $1 per unit)
    // Cost = fair_price * quantity
    return microAmount; // simplified: payout = quantity at max
  })();

  const handleQuickAdd = (val: number) => {
    const current = parseFloat(amount || '0');
    setAmount((current + val).toString());
  };

  const handleCreateManager = async () => {
    if (!address) return;
    setLoading(true);
    setError('');
    try {
      const tx = createManagerTx();
      await signAndExecute({ transaction: tx });
      // Wait for chain to index the new manager
      await new Promise(r => setTimeout(r, 3000));
      await refreshManager();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create manager';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleBet = async () => {
    if (!address) {
      setError('Connect wallet first');
      return;
    }
    if (!manager) {
      setError('Create a trading account first');
      return;
    }
    if (!selectedStrike) {
      setError('Select a strike price');
      return;
    }
    if (!microAmount || microAmount <= 0) {
      setError('Enter an amount');
      return;
    }
    if (microAmount > balance) {
      setError('Insufficient DUSDC');
      return;
    }

    setLoading(true);
    setError('');

    setFlashType(direction);
    setTimeout(() => setFlashType('none'), 400);

    try {
      const coinIds = coins.map(c => c.coinObjectId);
      const tx = depositAndMintTx(
        manager.manager_id,
        coinIds,
        BigInt(microAmount),
        round.oracleId,
        BigInt(round.expiry),
        BigInt(selectedStrike),
        direction,
        BigInt(microAmount), // quantity = amount (1 unit = $1)
      );

      await signAndExecute({ transaction: tx });

      // Save position locally
      savePosition({
        oracleId: round.oracleId,
        expiry: round.expiry,
        strike: selectedStrike,
        direction,
        quantity: microAmount,
        cost: microAmount,
        timestamp: Date.now(),
      });

      await refreshBalance();
      setAmount('');
      onSuccess?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      if (message.includes('Rejected') || message.includes('rejected')) {
        setError('Transaction rejected');
      } else if (message.includes('Insufficient')) {
        setError('Insufficient DUSDC');
      } else {
        setError(message.length > 80 ? message.slice(0, 80) + '...' : message);
      }
    } finally {
      setLoading(false);
    }
  };

  const isUp = direction === 'UP';

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
              ${flashType === 'UP' ? 'bg-new-mint/30' : 'bg-off-red/30'}`}
          />
        )}

        {/* UP / DOWN toggle */}
        <div className="p-4 pb-0">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDirection('UP')}
              className={`relative py-3.5 rounded-xl font-bold text-sm transition-all hover:brightness-110 active:scale-95 ${isUp
                ? 'text-new-mint brightness-125'
                : 'text-new-mint/70'
                }`}
              style={{ backgroundColor: '#1a3a2a' }}
            >
              <div className="flex items-center justify-center gap-2">
                <span>Up</span>
                <span className="font-mono">{odds.up}%</span>
              </div>
            </button>

            <button
              onClick={() => setDirection('DOWN')}
              className={`relative py-3.5 rounded-xl font-bold text-sm transition-all hover:brightness-110 active:scale-95 ${!isUp
                ? 'text-off-red brightness-125'
                : 'text-off-red/70'
                }`}
              style={{ backgroundColor: '#3a1a1e' }}
            >
              <div className="flex items-center justify-center gap-2">
                <span>Down</span>
                <span className="font-mono">{odds.down}%</span>
              </div>
            </button>
          </div>
        </div>

        {/* Strike selector */}
        <div className="px-4 pt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Strike Price</span>
          </div>
          <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-1">
            {strikes.slice(0, 10).map((strike) => (
              <button
                key={strike}
                onClick={() => setSelectedStrike(strike)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                  selectedStrike === strike
                    ? 'bg-white/10 text-white border border-white/20'
                    : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-white'
                }`}
              >
                {formatStrike(strike)}
              </button>
            ))}
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
              DUSDC
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
              onClick={() => setAmount((balance / DUSDC_MULTIPLIER).toString())}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white/[0.04] text-gray-400 border border-white/5 hover:bg-white/[0.08] hover:text-white transition-all"
            >
              Max
            </button>
          </div>

          {estPayout > 0 && (
            <div className="flex justify-between items-center text-xs px-1 pt-1">
              <span className="text-gray-500">Max payout</span>
              <div className="flex items-center gap-1 font-mono font-bold text-new-mint">
                <AnimatedNumber value={formatPred(estPayout)} />
                <span>DUSDC</span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-off-red text-xs font-bold text-center animate-pulse">{error}</p>
          )}

          {/* Confidence meter */}
          {price > 0 && minsLeft > 0 && selectedStrike && (
            (() => {
              const targetUsd = selectedStrike / FLOAT_SCALING;
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
                    <span className="text-[9px] text-off-red/60">DOWN</span>
                    <span className="text-[9px] text-new-mint/60">UP</span>
                  </div>
                </div>
              );
            })()
          )}

          {/* CTA button */}
          {address ? (
            !manager ? (
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleCreateManager}
                disabled={loading}
                className="w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-wider bg-new-blue text-white transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  'Create Trading Account'
                )}
              </motion.button>
            ) : (
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
                  backgroundColor: isUp ? '#34D399' : '#F43F5E',
                  color: isUp ? '#000' : '#fff',
                  opacity: (loading || !amount || parseFloat(amount) <= 0 || round.resolved) ? 0.5 : 1,
                }}
              >
                {loading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  `Buy ${isUp ? 'Up' : 'Down'}`
                )}
              </motion.button>
            )
          ) : (
            <div className="w-full py-3.5 rounded-xl bg-white/[0.05] border border-white/10 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
              <Wallet className="w-4 h-4" />
              Connect wallet to trade
            </div>
          )}

          {/* Get DUSDC shortcut */}
          {address && (
            <GetDUSDCButton />
          )}
        </div>
      </div>
    </>
  );
}

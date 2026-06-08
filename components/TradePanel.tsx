'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Loader2,
  Check,
  AlertCircle,
  ChevronDown,
  Wallet,
} from 'lucide-react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import type { OracleData } from '@/lib/sui/predictApi';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { useManager, useDUSDCBalance, useManagerBalance, useSviPricing, useVaultStats } from '@/lib/sui/hooks';
import {
  createManagerTx,
  depositFromWalletTx,
  depositAndMintTx,
  depositAndMintRangeTx,
  mintPositionTx,
  mintRangePositionTx,
} from '@/lib/sui/predictClient';
import { generateStrikeGrid, formatStrike, nearestStrike, savePosition } from '@/lib/roundHelpers';
import { computeSviPrice, computeRangePrice, computeFeeBreakdown, type FeeBreakdown } from '@/lib/sui/sviPricing';
import Countdown from './Countdown';
import TradeConfirmationModal from './TradeConfirmationModal';
import Tooltip from './Tooltip';
import { useToast } from './Toast';

interface TradePanelProps {
  oracle: OracleData;
  spotPrice?: number | null;
  forwardPrice?: number | null;
  defaultSide?: 'UP' | 'DOWN';
  onSuccess?: () => void;
}

type Side = 'UP' | 'DOWN' | 'RANGE';
type Step = 'idle' | 'creating-manager' | 'depositing' | 'minting' | 'success' | 'error';

export default function TradePanel({
  oracle,
  spotPrice,
  forwardPrice,
  defaultSide = 'UP',
  onSuccess,
}: TradePanelProps) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { manager, loading: managerLoading, refresh: refreshManager } = useManager();
  const { balance: walletBalance, coins, refresh: refreshBalance } = useDUSDCBalance();
  const { balance: managerBalance, refresh: refreshManagerBalance } = useManagerBalance(manager?.manager_id ?? null);
  const { sviData } = useSviPricing(oracle.oracle_id);
  const { stats: vaultStats } = useVaultStats();
  const { toast } = useToast();

  const [side, setSide] = useState<Side>(defaultSide);
  const [amount, setAmount] = useState('10');
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [rangeUpperStrike, setRangeUpperStrike] = useState<number | null>(null);
  const [showStrikeSelector, setShowStrikeSelector] = useState(false);
  const [showUpperStrikeSelector, setShowUpperStrikeSelector] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [txDigest, setTxDigest] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Generate strike grid centered around current price
  const refPriceForGrid = forwardPrice ?? spotPrice ?? undefined;
  const strikes = generateStrikeGrid(oracle.min_strike, oracle.tick_size, 50, refPriceForGrid);

  // Auto-select nearest strike to spot/forward
  useEffect(() => {
    if (selectedStrike !== null) return;
    const refPrice = forwardPrice || spotPrice;
    if (refPrice && oracle.tick_size > 0) {
      const nearest = nearestStrike(refPrice, oracle.min_strike, oracle.tick_size);
      setSelectedStrike(nearest);
    } else if (strikes.length > 0) {
      setSelectedStrike(strikes[Math.floor(strikes.length / 2)]);
    }
  }, [spotPrice, forwardPrice, oracle.min_strike, oracle.tick_size, selectedStrike, strikes]);

  const amountMicro = Math.floor(parseFloat(amount || '0') * DUSDC_MULTIPLIER);
  const isValidAmount = amountMicro > 0;
  const hasEnoughBalance = walletBalance >= amountMicro || managerBalance >= amountMicro;

  // Range validation
  const isRangeValid = side !== 'RANGE' || (selectedStrike !== null && rangeUpperStrike !== null && selectedStrike < rangeUpperStrike);

  // Compute SVI fair price for selected strike
  const fairPrice = useMemo(() => {
    if (!sviData?.params || !forwardPrice) return null;
    if (side === 'RANGE' && selectedStrike && rangeUpperStrike) {
      return computeRangePrice(sviData.params, selectedStrike, rangeUpperStrike, forwardPrice);
    }
    if (!selectedStrike) return null;
    const p = computeSviPrice(sviData.params, selectedStrike, forwardPrice);
    return side === 'DOWN' ? 1 - p : p;
  }, [sviData, selectedStrike, rangeUpperStrike, forwardPrice, side]);

  // Compute fee breakdown
  const feeBreakdown = useMemo((): FeeBreakdown | null => {
    if (fairPrice === null || !vaultStats) return null;
    const fairScaled = fairPrice * FLOAT_SCALING;
    return computeFeeBreakdown(
      fairScaled,
      vaultStats.baseFee,
      vaultStats.minFee,
      vaultStats.utilizationMultiplier,
      vaultStats.totalMtm,
      vaultStats.balance,
    );
  }, [fairPrice, vaultStats]);

  const handleTrade = useCallback(async () => {
    if (!address || !selectedStrike || !isValidAmount || !isRangeValid) return;

    setErrorMsg('');
    setTxDigest('');

    try {
      let managerId = manager?.manager_id;

      // Step 1: Create manager if needed
      if (!managerId) {
        setStep('creating-manager');
        const tx = createManagerTx();
        const result = await signAndExecute({
          transaction: tx,
        });
        await client.waitForTransaction({ digest: result.digest });
        await refreshManager();
        const { fetchManagerForAddress } = await import('@/lib/sui/predictApi');
        const m = await fetchManagerForAddress(address);
        if (!m) throw new Error('Failed to create manager');
        managerId = m.manager_id;
      }

      // Step 2: Deposit + Mint
      const needsDeposit = managerBalance < amountMicro;

      if (side === 'RANGE' && rangeUpperStrike) {
        setStep('minting');
        if (needsDeposit && coins.length > 0) {
          const coinIds = coins.map(c => c.coinObjectId);
          const tx = depositAndMintRangeTx(
            managerId,
            coinIds,
            BigInt(amountMicro),
            oracle.oracle_id,
            BigInt(oracle.expiry),
            BigInt(selectedStrike),
            BigInt(rangeUpperStrike),
            BigInt(amountMicro),
          );
          const result = await signAndExecute({ transaction: tx });
          await client.waitForTransaction({ digest: result.digest });
          setTxDigest(result.digest);
        } else {
          const tx = mintRangePositionTx(
            managerId,
            oracle.oracle_id,
            BigInt(oracle.expiry),
            BigInt(selectedStrike),
            BigInt(rangeUpperStrike),
            BigInt(amountMicro),
          );
          const result = await signAndExecute({ transaction: tx });
          await client.waitForTransaction({ digest: result.digest });
          setTxDigest(result.digest);
        }
      } else if (needsDeposit && coins.length > 0) {
        setStep('minting');
        const coinIds = coins.map(c => c.coinObjectId);
        const tx = depositAndMintTx(
          managerId,
          coinIds,
          BigInt(amountMicro),
          oracle.oracle_id,
          BigInt(oracle.expiry),
          BigInt(selectedStrike),
          side as 'UP' | 'DOWN',
          BigInt(amountMicro),
        );
        const result = await signAndExecute({ transaction: tx });
        await client.waitForTransaction({ digest: result.digest });
        setTxDigest(result.digest);
      } else {
        setStep('minting');
        const tx = mintPositionTx(
          managerId,
          oracle.oracle_id,
          BigInt(oracle.expiry),
          BigInt(selectedStrike),
          side as 'UP' | 'DOWN',
          BigInt(amountMicro),
        );
        const result = await signAndExecute({ transaction: tx });
        await client.waitForTransaction({ digest: result.digest });
        setTxDigest(result.digest);
      }

      savePosition({
        oracleId: oracle.oracle_id,
        expiry: oracle.expiry,
        strike: selectedStrike,
        direction: side === 'RANGE' ? 'UP' : side,
        quantity: amountMicro,
        cost: amountMicro,
        timestamp: Date.now(),
        txDigest: txDigest,
      });

      setStep('success');
      refreshBalance();
      refreshManagerBalance();
      onSuccess?.();
      const strikeLabel = selectedStrike ? `$${(selectedStrike / FLOAT_SCALING).toLocaleString()}` : '';
      toast(`Position opened: ${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC on ${oracle.underlying_asset || 'BTC'} ${side} ${strikeLabel}`, 'success');

      setTimeout(() => {
        setStep('idle');
        setAmount('10');
      }, 3000);
    } catch (err: unknown) {
      console.error('Trade error:', err);
      setStep('error');
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      setErrorMsg(msg);
      toast(`Transaction failed: ${msg.slice(0, 100)}`, 'error');
    }
  }, [
    address, selectedStrike, rangeUpperStrike, isValidAmount, isRangeValid, manager, managerBalance,
    amountMicro, coins, oracle, side, signAndExecute, client,
    refreshManager, refreshBalance, refreshManagerBalance, onSuccess, txDigest,
  ]);

  const quickAmounts = [5, 10, 25, 50, 100];
  const strikeDollars = selectedStrike ? selectedStrike / FLOAT_SCALING : 0;
  const upperStrikeDollars = rangeUpperStrike ? rangeUpperStrike / FLOAT_SCALING : 0;

  if (!address) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-neutral-900/60 p-6 text-center">
        <Wallet className="w-8 h-8 text-gray-600 mx-auto mb-3" />
        <p className="text-sm text-gray-400 mb-1">Connect your wallet to trade</p>
        <p className="text-xs text-gray-600">Sui Wallet required</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-neutral-900/60 overflow-hidden">
      {/* Side selector */}
      <div className="flex border-b border-white/5">
        <button
          onClick={() => setSide('UP')}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-bold transition-all ${
            side === 'UP'
              ? 'bg-emerald-500/10 text-emerald-400 border-b-2 border-emerald-400'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          Up
        </button>
        <button
          onClick={() => setSide('DOWN')}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-bold transition-all ${
            side === 'DOWN'
              ? 'bg-rose-500/10 text-rose-400 border-b-2 border-rose-400'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <TrendingDown className="w-4 h-4" />
          Down
        </button>
        <button
          onClick={() => setSide('RANGE')}
          className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-bold transition-all ${
            side === 'RANGE'
              ? 'bg-amber-500/10 text-amber-400 border-b-2 border-amber-400'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <Activity className="w-4 h-4" />
          Range
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* Strike selector(s) */}
        {side === 'RANGE' ? (
          <div className="grid grid-cols-2 gap-3">
            {/* Lower strike */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-2">
                Lower Strike
              </label>
              <button
                onClick={() => { setShowStrikeSelector(!showStrikeSelector); setShowUpperStrikeSelector(false); }}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-white/20 transition-colors text-sm"
              >
                <span className="text-white font-mono font-bold">
                  {selectedStrike ? formatStrike(selectedStrike) : 'Select'}
                </span>
                <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${showStrikeSelector ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {/* Upper strike */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-2">
                Upper Strike
              </label>
              <button
                onClick={() => { setShowUpperStrikeSelector(!showUpperStrikeSelector); setShowStrikeSelector(false); }}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-white/20 transition-colors text-sm"
              >
                <span className="text-white font-mono font-bold">
                  {rangeUpperStrike ? formatStrike(rangeUpperStrike) : 'Select'}
                </span>
                <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${showUpperStrikeSelector ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {/* Lower strike dropdown */}
            <AnimatePresence>
              {showStrikeSelector && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden col-span-2"
                >
                  <div className="max-h-36 overflow-y-auto rounded-xl border border-white/[0.08] bg-black/40 scrollbar-hide">
                    {strikes.map((strike) => {
                      const dollars = strike / FLOAT_SCALING;
                      const isSelected = strike === selectedStrike;
                      return (
                        <button
                          key={strike}
                          onClick={() => { setSelectedStrike(strike); setShowStrikeSelector(false); }}
                          className={`w-full flex items-center px-4 py-2 text-sm transition-colors ${
                            isSelected ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <span className="font-mono">${dollars.toLocaleString()}</span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Upper strike dropdown */}
            <AnimatePresence>
              {showUpperStrikeSelector && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden col-span-2"
                >
                  <div className="max-h-36 overflow-y-auto rounded-xl border border-white/[0.08] bg-black/40 scrollbar-hide">
                    {strikes.filter(s => !selectedStrike || s > selectedStrike).map((strike) => {
                      const dollars = strike / FLOAT_SCALING;
                      const isSelected = strike === rangeUpperStrike;
                      return (
                        <button
                          key={strike}
                          onClick={() => { setRangeUpperStrike(strike); setShowUpperStrikeSelector(false); }}
                          className={`w-full flex items-center px-4 py-2 text-sm transition-colors ${
                            isSelected ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <span className="font-mono">${dollars.toLocaleString()}</span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Validation */}
            {selectedStrike && rangeUpperStrike && selectedStrike >= rangeUpperStrike && (
              <p className="text-[10px] text-rose-400 col-span-2">Lower strike must be below upper strike</p>
            )}
          </div>
        ) : (
          <div>
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-2">
              Strike Price
            </label>
            <button
              onClick={() => setShowStrikeSelector(!showStrikeSelector)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-white/20 transition-colors"
            >
              <span className="text-white font-mono font-bold">
                {selectedStrike ? formatStrike(selectedStrike) : 'Select strike'}
              </span>
              <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showStrikeSelector ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {showStrikeSelector && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-white/[0.08] bg-black/40 scrollbar-hide">
                    {strikes.map((strike) => {
                      const dollars = strike / FLOAT_SCALING;
                      const isSelected = strike === selectedStrike;
                      const spotDollars = spotPrice ? spotPrice / FLOAT_SCALING : null;
                      const isNearSpot = spotDollars && Math.abs(dollars - spotDollars) < (oracle.tick_size / FLOAT_SCALING) * 2;

                      // SVI fair price for this strike
                      let strikeFairPrice: number | null = null;
                      if (sviData?.params && forwardPrice) {
                        const p = computeSviPrice(sviData.params, strike, forwardPrice);
                        strikeFairPrice = side === 'DOWN' ? 1 - p : p;
                      }

                      return (
                        <button
                          key={strike}
                          onClick={() => {
                            setSelectedStrike(strike);
                            setShowStrikeSelector(false);
                          }}
                          className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                            isSelected
                              ? 'bg-white/10 text-white'
                              : 'text-gray-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <span className="font-mono">${dollars.toLocaleString()}</span>
                          <span className="flex items-center gap-2">
                            {strikeFairPrice !== null && (
                              <span className="text-[9px] font-mono text-vermilion/70">
                                {(strikeFairPrice * 100).toFixed(1)}%
                              </span>
                            )}
                            {isNearSpot && (
                              <span className="text-[10px] font-bold text-new-mint bg-new-mint/10 px-2 py-0.5 rounded-full">
                                Near spot
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Amount input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
              Amount (DUSDC)
            </label>
            <span className="text-[10px] text-gray-600">
              Wallet: {(walletBalance / DUSDC_MULTIPLIER).toFixed(2)} | Manager: {(managerBalance / DUSDC_MULTIPLIER).toFixed(2)}
            </span>
          </div>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="1"
              className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-lg outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500">
              DUSDC
            </span>
          </div>

          {/* Quick amount buttons */}
          <div className="flex gap-2 mt-2">
            {quickAmounts.map((qa) => (
              <button
                key={qa}
                onClick={() => setAmount(String(qa))}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                  amount === String(qa)
                    ? 'border-white/20 bg-white/10 text-white'
                    : 'border-white/5 bg-white/[0.02] text-gray-500 hover:text-gray-300'
                }`}
              >
                {qa}
              </button>
            ))}
          </div>
        </div>

        {/* Trade summary */}
        <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Direction</span>
            <span className={`font-bold ${
              side === 'UP' ? 'text-emerald-400' : side === 'DOWN' ? 'text-rose-400' : 'text-amber-400'
            }`}>
              {side === 'UP' ? 'UP' : side === 'DOWN' ? 'DOWN' : 'RANGE'}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Strike</span>
            <span className="text-white font-mono">
              {side === 'RANGE'
                ? selectedStrike && rangeUpperStrike
                  ? `$${strikeDollars.toLocaleString()} — $${upperStrikeDollars.toLocaleString()}`
                  : '—'
                : selectedStrike ? `$${strikeDollars.toLocaleString()}` : '—'
              }
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Cost</span>
            <span className="text-white font-mono font-bold">
              {isValidAmount ? `${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Expires</span>
            <span className="text-white">
              <Countdown expiryMs={oracle.expiry} className="text-xs" />
            </span>
          </div>

          {/* Fee breakdown (estimated) */}
          {feeBreakdown && (
            <div className="space-y-1.5 py-2 border-t border-white/5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500 inline-flex items-center gap-1">Fair Price (est.) <Tooltip text="SVI-derived probability of settlement above strike, based on implied volatility surface." position="bottom" /></span>
                <span className="text-white font-mono">{(feeBreakdown.fairPrice * 100).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500 inline-flex items-center gap-1">Fee (est.) <Tooltip text="Bernoulli + utilization fee from the vault. Scales with vault utilization." position="bottom" /></span>
                <span className="text-gray-400 font-mono">{(feeBreakdown.totalFee * 100).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Total Cost / Unit</span>
                <span className="text-white font-mono font-semibold">{(feeBreakdown.totalCostPerUnit * 100).toFixed(2)}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Execute button */}
        <button
          onClick={() => setShowConfirmModal(true)}
          disabled={!isValidAmount || !selectedStrike || step !== 'idle' || !hasEnoughBalance || !isRangeValid}
          className={`w-full py-4 rounded-xl text-sm font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            side === 'UP'
              ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_20px_rgba(16,185,129,0.2)]'
              : side === 'DOWN'
                ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-[0_0_20px_rgba(244,63,94,0.2)]'
                : 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)]'
          }`}
        >
          {step === 'creating-manager' ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating account...
            </span>
          ) : step === 'depositing' ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Depositing...
            </span>
          ) : step === 'minting' ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Confirming trade...
            </span>
          ) : step === 'success' ? (
            <span className="flex items-center justify-center gap-2">
              <Check className="w-4 h-4" />
              Trade confirmed!
            </span>
          ) : !isValidAmount ? (
            'Enter amount'
          ) : !hasEnoughBalance ? (
            'Insufficient DUSDC'
          ) : !isRangeValid ? (
            'Select valid range'
          ) : side === 'RANGE' ? (
            `Buy Range — ${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC`
          ) : (
            `Buy ${side === 'UP' ? 'Up' : 'Down'} — ${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC`
          )}
        </button>

        {/* Error message */}
        <AnimatePresence>
          {step === 'error' && errorMsg && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-rose-400 font-bold">Transaction failed</p>
                <p className="text-[11px] text-rose-400/60 mt-0.5 break-all">{errorMsg.slice(0, 200)}</p>
                <button
                  onClick={() => { setStep('idle'); setErrorMsg(''); }}
                  className="text-[10px] text-rose-400 underline mt-1"
                >
                  Try again
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success tx link */}
        <AnimatePresence>
          {step === 'success' && txDigest && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <a
                href={`https://suiscan.xyz/testnet/tx/${txDigest}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-[11px] text-new-mint/60 hover:text-new-mint transition-colors"
              >
                View on Suiscan
              </a>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Manager info */}
        {!managerLoading && !manager && address && (
          <p className="text-[10px] text-gray-600 text-center">
            First trade will create your PredictManager account
          </p>
        )}
      </div>

      {/* Confirmation modal */}
      {showConfirmModal && selectedStrike && (
        <TradeConfirmationModal
          side={side}
          asset={oracle.underlying_asset || 'BTC'}
          strike={selectedStrike}
          upperStrike={side === 'RANGE' ? rangeUpperStrike : null}
          amount={amountMicro}
          fairPrice={fairPrice}
          feeBreakdown={feeBreakdown}
          expiry={oracle.expiry}
          onConfirm={() => {
            setShowConfirmModal(false);
            handleTrade();
          }}
          onCancel={() => setShowConfirmModal(false)}
        />
      )}
    </div>
  );
}

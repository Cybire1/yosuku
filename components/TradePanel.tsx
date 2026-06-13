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
import { useCurrentAccount, useSignAndExecuteTransaction, useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
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
import { fetchOnChainQuote, fetchOnChainRangeQuote, type OnChainQuote } from '@/lib/sui/onchainQuote';
import { openLeveragedRangeTx, openLeveragedBinaryTx } from '@/lib/sui/leverageClient';
import { useDailyStop } from '@/lib/dailyStop';
import { getSponsorStatus, submitSponsored, type SponsorStatus } from '@/lib/sponsor';
import { humanizeTxError } from '@/lib/errorMessages';
import Countdown from './Countdown';
import AccountSetup from './AccountSetup';
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
  const { mutateAsync: signTransaction } = useSignTransaction();
  const { manager, loading: managerLoading, refresh: refreshManager } = useManager();
  const { balance: walletBalance, coins, refresh: refreshBalance } = useDUSDCBalance();
  const { balance: managerBalance, refresh: refreshManagerBalance } = useManagerBalance(manager?.manager_id ?? null);
  const { sviData } = useSviPricing(oracle.oracle_id);
  const { stats: vaultStats } = useVaultStats();
  const { toast } = useToast();

  const [side, setSide] = useState<Side>(defaultSide);
  const [leverage, setLeverage] = useState(1); // 1× = no leverage; 2×/3× borrow from yolev pool
  const [amount, setAmount] = useState('10');
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [rangeUpperStrike, setRangeUpperStrike] = useState<number | null>(null);
  const [showStrikeSelector, setShowStrikeSelector] = useState(false);
  const [showUpperStrikeSelector, setShowUpperStrikeSelector] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [txDigest, setTxDigest] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [onChainQuote, setOnChainQuote] = useState<OnChainQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(false);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [errorDetail, setErrorDetail] = useState('');
  const [isTwoStep, setIsTwoStep] = useState(false);
  // Gas sponsorship (Onara): zkLogin users hold zero SUI — when the gas
  // station is up and the wallet can't cover gas, the sponsor pays it.
  const [sponsor, setSponsor] = useState<SponsorStatus | null>(null);
  const [suiLow, setSuiLow] = useState(false);
  useEffect(() => { getSponsorStatus().then(setSponsor); }, []);
  useEffect(() => {
    if (!address) { setSuiLow(false); return; }
    let cancelled = false;
    const check = async () => {
      try {
        const b = await client.getBalance({ owner: address });
        if (!cancelled) setSuiLow(Number(b.totalBalance) < 50_000_000); // < 0.05 SUI
      } catch { /* keep last */ }
    };
    check();
    const iv = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [address, client]);

  // Execute a tx: sponsored (sponsor pays gas) when needed, normal otherwise.
  const execTx = useCallback(async (tx: Transaction): Promise<string> => {
    if (sponsor && suiLow && address) {
      tx.setSender(address);
      tx.setGasOwner(sponsor.address);
      const bytes = await tx.build({ client });
      const signed = await signTransaction({ transaction: Transaction.from(bytes) });
      const { digest } = await submitSponsored({ sender: address, txBytes: signed.bytes, txSignature: signed.signature });
      await client.waitForTransaction({ digest });
      return digest;
    }
    const result = await signAndExecute({ transaction: tx });
    await client.waitForTransaction({ digest: result.digest });
    return result.digest;
  }, [sponsor, suiLow, address, client, signTransaction, signAndExecute]);
  const { limit: dailyStopLimit, setLimit: setDailyStopLimit, todayLoss, stopHit } = useDailyStop();
  const [editingStop, setEditingStop] = useState(false);
  const [stopInput, setStopInput] = useState('');

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

  // Exact on-chain cost (UP / DOWN / RANGE) — devInspect get_trade_amounts or
  // get_range_trade_amounts. Debounced; gives the contract's real cost, not the SVI estimate.
  useEffect(() => {
    const isRange = side === 'RANGE';
    const ready =
      isValidAmount &&
      selectedStrike !== null &&
      (isRange ? rangeUpperStrike !== null && selectedStrike < rangeUpperStrike : true);
    if (!ready) {
      setOnChainQuote(null);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    const t = setTimeout(async () => {
      try {
        const q = isRange
          ? await fetchOnChainRangeQuote({
              oracleId: oracle.oracle_id,
              expiry: oracle.expiry,
              lower: selectedStrike!,
              higher: rangeUpperStrike!,
              quantity: amountMicro,
            })
          : await fetchOnChainQuote({
              oracleId: oracle.oracle_id,
              expiry: oracle.expiry,
              strike: selectedStrike!,
              isUp: side === 'UP',
              quantity: amountMicro,
            });
        if (!cancelled) {
          setOnChainQuote(q);
          setQuoteError(false);
        }
      } catch {
        if (!cancelled) {
          setOnChainQuote(null);
          setQuoteError(true);
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [oracle.oracle_id, oracle.expiry, selectedStrike, rangeUpperStrike, side, amountMicro, isValidAmount, quoteRetry]);

  const handleTrade = useCallback(async () => {
    if (!address || !selectedStrike || !isValidAmount || !isRangeValid) return;

    setErrorMsg('');
    setTxDigest('');
    setIsTwoStep(!manager?.manager_id);

    try {
      let managerId = manager?.manager_id;

      // Step 1: Create manager if needed
      if (!managerId) {
        setStep('creating-manager');
        const tx = createManagerTx();
        await execTx(tx);
        await refreshManager();
        const { fetchManagerForAddress } = await import('@/lib/sui/predictApi');
        const m = await fetchManagerForAddress(address);
        if (!m) throw new Error('Failed to create manager');
        managerId = m.manager_id;
      }

      // Step 2: Deposit + Mint
      const needsDeposit = managerBalance < amountMicro;

      if (leverage > 1) {
        // Leveraged: borrow (L-1)× from the yolev pool, mint an L× position.
        setStep('minting');
        const coinIds = coins.map(c => c.coinObjectId);
        const margin = BigInt(amountMicro);
        const borrow = BigInt(Math.floor(amountMicro * (leverage - 1)));
        const qty = BigInt(amountMicro * leverage);
        const tx = side === 'RANGE' && rangeUpperStrike
          ? openLeveragedRangeTx({
              managerId, coinIds, marginAmount: margin, borrowAmount: borrow,
              oracleId: oracle.oracle_id, expiry: BigInt(oracle.expiry),
              lower: BigInt(selectedStrike), higher: BigInt(rangeUpperStrike), quantity: qty, owner: address,
            })
          : openLeveragedBinaryTx({
              managerId, coinIds, marginAmount: margin, borrowAmount: borrow,
              oracleId: oracle.oracle_id, expiry: BigInt(oracle.expiry),
              strike: BigInt(selectedStrike), isUp: side === 'UP', quantity: qty, owner: address,
            });
        setTxDigest(await execTx(tx));
      } else if (side === 'RANGE' && rangeUpperStrike) {
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
          setTxDigest(await execTx(tx));
        } else {
          const tx = mintRangePositionTx(
            managerId,
            oracle.oracle_id,
            BigInt(oracle.expiry),
            BigInt(selectedStrike),
            BigInt(rangeUpperStrike),
            BigInt(amountMicro),
          );
          setTxDigest(await execTx(tx));
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
        setTxDigest(await execTx(tx));
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
        setTxDigest(await execTx(tx));
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
      const friendly = humanizeTxError(err);
      setErrorMsg(friendly.title);
      setErrorDetail(friendly.detail);
      toast(friendly.title, 'error');
    }
  }, [
    address, selectedStrike, rangeUpperStrike, isValidAmount, isRangeValid, manager, managerBalance,
    amountMicro, coins, oracle, side, execTx, leverage,
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

        {/* Leverage (yolev lending pool) */}
        <div className="mt-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-500 text-xs inline-flex items-center gap-1">
              Leverage <span className="text-[8px] font-bold uppercase tracking-wider text-vermilion/80 bg-vermilion/10 px-1 py-0.5 rounded">yolev</span>
              <Tooltip text="Borrow DUSDC from the yosuku lending pool to open a larger position. Higher leverage = higher liquidation risk." position="bottom" />
            </span>
            <span className="font-mono text-xs text-white">{leverage}×</span>
          </div>
          <div className="flex gap-2">
            {[1, 2, 3].map((l) => (
              <button
                key={l}
                onClick={() => setLeverage(l)}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                  leverage === l ? 'border-vermilion/50 bg-vermilion/10 text-vermilion' : 'border-white/5 bg-white/[0.02] text-gray-500 hover:text-gray-300'
                }`}
              >
                {l}×
              </button>
            ))}
          </div>
          {leverage > 1 && isValidAmount && (
            <div className="mt-2 rounded-lg bg-vermilion/[0.04] border border-vermilion/10 px-3 py-2 space-y-1 text-xs">
              <div className="flex justify-between"><span className="text-gray-500">Borrowed</span><span className="font-mono text-white">{(amountMicro * (leverage - 1) / DUSDC_MULTIPLIER).toFixed(2)} DUSDC</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Position size</span><span className="font-mono text-white">{(amountMicro * leverage / DUSDC_MULTIPLIER).toFixed(2)} DUSDC</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Liquidates if value &lt;</span><span className="font-mono text-amber-400">{(amountMicro * (leverage - 1) * 1.1 / DUSDC_MULTIPLIER).toFixed(2)} DUSDC</span></div>
            </div>
          )}
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
            <span className="text-gray-500 inline-flex items-center gap-1">
              Deposit <Tooltip text="DUSDC moved into your PredictManager. Anything above the trade cost stays as reusable manager balance." position="bottom" />
            </span>
            <span className="text-white font-mono font-bold">
              {isValidAmount ? `${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC` : '—'}
            </span>
          </div>
          {/* on-chain cost now available for UP / DOWN / RANGE */}
          {(
            <>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500 inline-flex items-center gap-1">
                  Trade cost <span className="text-[8px] font-bold uppercase tracking-wider text-vermilion/80 bg-vermilion/10 px-1 py-0.5 rounded">on-chain</span>
                  <Tooltip text={side === 'RANGE' ? 'Read live from the contract via get_range_trade_amounts (devInspect) — the exact DUSDC this range costs now.' : 'Read live from the contract via get_trade_amounts (devInspect) — the exact DUSDC this trade costs right now, not an estimate.'} position="bottom" />
                </span>
                <span className="text-white font-mono font-bold">
                  {quoteLoading ? '…' : onChainQuote ? `${onChainQuote.mintCost.toFixed(4)} DUSDC` : quoteError ? (
                    <button
                      onClick={() => setQuoteRetry((k) => k + 1)}
                      className="text-rose-400/90 font-sans font-medium text-[11px] underline underline-offset-2 hover:text-rose-300"
                    >
                      quote unavailable — retry
                    </button>
                  ) : '—'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Max payout</span>
                <span className="text-emerald-400/90 font-mono">
                  {isValidAmount ? `${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC` : '—'}
                </span>
              </div>
            </>
          )}
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
          disabled={!isValidAmount || !selectedStrike || step !== 'idle' || !hasEnoughBalance || !isRangeValid || stopHit}
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
              Setting up your account (1 of 2)...
            </span>
          ) : step === 'depositing' ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Depositing...
            </span>
          ) : step === 'minting' ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {isTwoStep ? 'Placing your trade (2 of 2)...' : 'Confirming trade...'}
            </span>
          ) : step === 'success' ? (
            <span className="flex items-center justify-center gap-2">
              <Check className="w-4 h-4" />
              Trade confirmed!
            </span>
          ) : stopHit ? (
            'Daily stop hit — back tomorrow'
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
              <div className="min-w-0">
                <p className="text-xs text-rose-400 font-bold">{errorMsg || 'Transaction failed'}</p>
                {errorDetail && errorDetail !== errorMsg && (
                  <details className="mt-1">
                    <summary className="text-[10px] text-rose-400/50 cursor-pointer select-none">technical details</summary>
                    <p className="text-[11px] text-rose-400/60 mt-1 break-all max-h-24 overflow-y-auto">{errorDetail}</p>
                  </details>
                )}
                <button
                  onClick={() => { setStep('idle'); setErrorMsg(''); setErrorDetail(''); }}
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

        {/* One-time account setup (sponsored when a gas station is configured) */}
        {!managerLoading && !manager && address && (
          <AccountSetup onReady={() => { refreshManager(); }} />
        )}

        {/* Daily loss stop — honest brakes on a 15-minute market */}
        <div className="flex items-center justify-between text-[11px] px-1">
          <span className="text-gray-600">
            Daily stop{dailyStopLimit !== null && (
              <span className={stopHit ? 'text-loss font-semibold' : 'text-gray-500'}>
                {' '}· lost {todayLoss.toFixed(2)} / {dailyStopLimit.toFixed(0)} DUSDC
              </span>
            )}
          </span>
          {editingStop ? (
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                value={stopInput}
                onChange={(e) => setStopInput(e.target.value)}
                placeholder="25"
                min="1"
                autoFocus
                className="w-16 px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/10 text-white font-mono text-[11px] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={() => { const v = parseFloat(stopInput); setDailyStopLimit(Number.isFinite(v) && v > 0 ? v : null); setEditingStop(false); }}
                className="text-gray-400 hover:text-white"
              >
                set
              </button>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {dailyStopLimit !== null && (
                <button onClick={() => setDailyStopLimit(null)} className="text-gray-600 hover:text-gray-400">off</button>
              )}
              <button
                onClick={() => { setStopInput(dailyStopLimit !== null ? String(dailyStopLimit) : ''); setEditingStop(true); }}
                className="text-gray-500 hover:text-white underline underline-offset-2"
              >
                {dailyStopLimit === null ? 'set a limit' : 'edit'}
              </button>
            </span>
          )}
        </div>
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
          onChainCost={onChainQuote?.mintCost ?? null}
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

'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  ShieldCheck,
  LockKeyhole,
  LogOut,
} from 'lucide-react';
import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import type { OracleData } from '@/lib/sui/predictApi';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { useManager, useDUSDCBalance, useManagerBalance, useSviPricing, useVaultStats, useTradingVaultBalance } from '@/lib/sui/hooks';
import {
  createManagerTx,
  tradingBalanceDepositAndMintRangeTx,
  tradingBalanceDepositAndMintTx,
} from '@/lib/sui/predictClient';
import { defaultStrike, generateDisplayStrikeGrid, formatStrike, nearestStrike, savePosition } from '@/lib/roundHelpers';
import { computeSviPrice, computeRangePrice, computeFeeBreakdown, type FeeBreakdown } from '@/lib/sui/sviPricing';
import { fetchOnChainQuote, fetchOnChainRangeQuote, type OnChainQuote } from '@/lib/sui/onchainQuote';
import {
  fundAndOpenTradingBalanceBinaryLeverageTx,
  fundAndOpenTradingBalanceRangeLeverageTx,
} from '@/lib/sui/tradingVaultClient';
import { useReserveStats } from '@/lib/sui/leverageHooks';
import { recordLocalLeverageOrder } from '@/lib/leverageLocal';
import { useDailyStop } from '@/lib/dailyStop';
import { humanizeTxError } from '@/lib/errorMessages';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import Countdown from './Countdown';
import TradeConfirmationModal from './TradeConfirmationModal';
import Tooltip from './Tooltip';
import { useToast } from './Toast';
import IncognitoToggle from './IncognitoToggle';
import {
  EMPTY_PRIVATE_STATUS,
  cashOutPrivateBet,
  getPrivateBetStatus,
  loadPrivateBetTickets,
  openPrivateBet,
  privateBalanceDusdc as getPrivateBalanceDusdc,
  savePrivateBetTickets,
  withdrawPrivateBalance,
  type PrivateBetStatus,
  type PrivateBetTicket,
  type PrivateWithdrawMode,
  type PrivacyMode,
} from '@/lib/privateBet';

// The quote path stays enabled right up to the bell and through the ~7s settlement
// window, but predict::mint aborts the moment the round leaves 'active'. Stop offering a
// bet in the final stretch so the user gets a clean hand-off instead of a wallet MoveAbort.
const CLOSING_MARGIN_MS = 20_000;
// DeepBook Predict rejects mints whose ask is outside this band.
// See predict::assert_mintable_ask / pricing defaults: 1c <= ask <= 99c.
const MIN_MINT_ASK = 0.01;
const MAX_MINT_ASK = 0.99;

interface TradePanelProps {
  oracle: OracleData;
  spotPrice?: number | null;
  forwardPrice?: number | null;
  defaultSide?: 'UP' | 'DOWN';
  initialStrike?: number | null;
  onSideChange?: (side: 'UP' | 'DOWN') => void;
  onStrikeChange?: (strike: number) => void;
  onSuccess?: () => void;
}

type Side = 'UP' | 'DOWN' | 'RANGE';
type Step = 'idle' | 'creating-manager' | 'depositing' | 'minting' | 'success' | 'error';

export default function TradePanel({
  oracle,
  spotPrice,
  forwardPrice,
  defaultSide = 'UP',
  initialStrike = null,
  onSideChange,
  onStrikeChange,
  onSuccess,
}: TradePanelProps) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();
  const { manager, loading: managerLoading, refresh: refreshManager } = useManager();
  const { balance: walletBalance, coins, refresh: refreshBalance } = useDUSDCBalance();
  const { refresh: refreshManagerBalance } = useManagerBalance(manager?.manager_id ?? null);
  const { balance: tradingVaultBalance, refresh: refreshTradingVaultBalance } = useTradingVaultBalance();
  const { sviData } = useSviPricing(oracle.oracle_id);
  const { stats: vaultStats } = useVaultStats();
  const { toast } = useToast();

  const [side, setSide] = useState<Side>(defaultSide);
  const [leverage, setLeverage] = useState(1); // 1× = no leverage; 2×/3× underwritten by the yolev reserve
  const { stats: reserveStats } = useReserveStats();
  const [amount, setAmount] = useState('10');
  const [selectedStrike, setSelectedStrike] = useState<number | null>(initialStrike);
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
  const { limit: dailyStopLimit, setLimit: setDailyStopLimit, todayLoss, stopHit } = useDailyStop();
  const [editingStop, setEditingStop] = useState(false);
  const [stopInput, setStopInput] = useState('');
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('public');
  const [privateStatus, setPrivateStatus] = useState<PrivateBetStatus>(EMPTY_PRIVATE_STATUS);
  const [privateTickets, setPrivateTickets] = useState<PrivateBetTicket[]>([]);

  // Live clock tick so the closing-margin guard re-evaluates every second. Init to 0
  // (set on mount) to avoid an SSR/client hydration mismatch on the disabled attribute.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => { setNowMs(Date.now()); const id = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(id); }, []);
  // True in the last CLOSING_MARGIN_MS before expiry → block new bets (mint would abort).
  const roundClosing = nowMs > 0 && nowMs >= Number(oracle.expiry) - CLOSING_MARGIN_MS;

  // Simple vs Pro. Beginners get a plain-English question (no "strike", no
  // leverage, no range); pros get the full machinery. Loaded from localStorage
  // in an effect (not lazy init) to avoid an SSR/client hydration mismatch.
  const [mode, setMode] = useState<'simple' | 'pro'>('simple');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('yosuku_trade_mode');
      if (saved === 'pro' || saved === 'simple') setMode(saved);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const status = await getPrivateBetStatus();
        if (!cancelled) setPrivateStatus(status);
      } catch {
        if (!cancelled) {
          setPrivateStatus({
            ready: false,
            label: 'BETA',
            reasons: ['Private route status is unavailable.'],
            vortexPool: '',
          });
        }
      }
    };
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    setPrivateTickets(loadPrivateBetTickets(address));
  }, [address]);

  const privateBalance = useMemo(() => getPrivateBalanceDusdc(privateTickets), [privateTickets]);

  const applyMode = useCallback((m: 'simple' | 'pro') => {
    setMode(m);
    try { localStorage.setItem('yosuku_trade_mode', m); } catch { /* ignore */ }
    setShowStrikeSelector(false);
    setShowUpperStrikeSelector(false);
    if (m === 'simple') {
      setLeverage(1);
      setSide((s) => {
        if (s === 'RANGE') { onSideChange?.('UP'); return 'UP'; }
        return s;
      });
    }
  }, [onSideChange]);

  const applyPrivacyMode = useCallback((next: PrivacyMode) => {
    setPrivacyMode(next);
    if (next === 'private') {
      setLeverage(1);
      setSide((current) => {
        if (current === 'RANGE') {
          onSideChange?.('UP');
          return 'UP';
        }
        return current;
      });
    }
  }, [onSideChange]);

  // Auto-provision the trading account in the background the moment a connected
  // user is on a market without one — so the first bet is a single tap and the
  // "create account" step is never shown. Sponsored (gas-free), fires once, silent
  // + non-blocking. If the user dismisses the signature, handleTrade still creates
  // it inline as a fallback at trade time, so nothing breaks either way.
  const provisioningRef = useRef(false);
  useEffect(() => {
    if (!address || manager || managerLoading || leverage !== 1 || provisioningRef.current) return;
    provisioningRef.current = true;
    (async () => {
      try {
        await submit(() => createManagerTx());
        await refreshManager();
      } catch {
        provisioningRef.current = false; // let trade-time inline creation retry
      }
    })();
  }, [address, manager, managerLoading, leverage, submit, refreshManager]);

  useEffect(() => {
    setSide(defaultSide);
  }, [defaultSide]);

  // Default app strike is a clean display line; explicit configuration uses the same coarse grid.
  const refPriceForGrid = forwardPrice ?? spotPrice ?? undefined;
  const strikes = useMemo(
    () => generateDisplayStrikeGrid(oracle.min_strike, oracle.tick_size, 21, refPriceForGrid),
    [oracle.min_strike, oracle.tick_size, refPriceForGrid],
  );
  const displayedStrikes = useMemo(() => {
    if (selectedStrike === null || strikes.includes(selectedStrike)) return strikes;
    return [...strikes, selectedStrike].sort((a, b) => a - b);
  }, [selectedStrike, strikes]);

  const chooseStrike = useCallback((strike: number) => {
    setSelectedStrike(strike);
    onStrikeChange?.(strike);
  }, [onStrikeChange]);

  // Continuous strike: a tappable numeric line the user can set to ANY price (kept legible
  // as a normal binary — they're just moving the win/lose line). Commit snaps to the protocol
  // tick grid; the existing on-chain quote effect re-prices on the committed strike.
  const [strikeInput, setStrikeInput] = useState('');
  useEffect(() => {
    if (selectedStrike) setStrikeInput((selectedStrike / FLOAT_SCALING).toLocaleString('en-US'));
  }, [selectedStrike]);
  const commitStrike = useCallback((dollars: number) => {
    if (!isFinite(dollars) || dollars <= 0 || oracle.tick_size <= 0) return;
    chooseStrike(nearestStrike(Math.round(dollars * FLOAT_SCALING), oracle.min_strike, oracle.tick_size));
  }, [chooseStrike, oracle.min_strike, oracle.tick_size]);

  useEffect(() => {
    if (initialStrike === null || initialStrike === selectedStrike) return;
    setSelectedStrike(initialStrike);
  }, [initialStrike, selectedStrike]);

  // Auto-select the stable default app line, not the raw nearest protocol tick.
  useEffect(() => {
    if (selectedStrike !== null) return;
    if (initialStrike !== null) {
      setSelectedStrike(initialStrike);
      return;
    }
    const refPrice = forwardPrice || spotPrice;
    if (refPrice && oracle.tick_size > 0) {
      const nearest = defaultStrike(refPrice, oracle.min_strike, oracle.tick_size);
      chooseStrike(nearest);
    } else if (displayedStrikes.length > 0) {
      chooseStrike(displayedStrikes[Math.floor(displayedStrikes.length / 2)]);
    }
  }, [chooseStrike, displayedStrikes, initialStrike, spotPrice, forwardPrice, oracle.min_strike, oracle.tick_size, selectedStrike]);

  const amountMicro = Math.floor(parseFloat(amount || '0') * DUSDC_MULTIPLIER);
  const isValidAmount = amountMicro > 0;
  const isLeveraged = leverage > 1;
  const usesSponsoredPrivateRoute = privacyMode === 'private' && privateStatus.mode === 'sponsored-session-manager';
  const hasEnoughBalance = usesSponsoredPrivateRoute
    ? true
    : isLeveraged
    ? walletBalance + tradingVaultBalance.available >= amountMicro
    : walletBalance + tradingVaultBalance.available >= amountMicro;

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

  // Raw up-probability (fee-less) — used only for the Simple-mode per-side
  // "chance" hint. The summary's "To win" remains the on-chain source of truth.
  const upProb = useMemo(() => {
    if (!sviData?.params || !forwardPrice || !selectedStrike) return null;
    return computeSviPrice(sviData.params, selectedStrike, forwardPrice);
  }, [sviData, forwardPrice, selectedStrike]);

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

  // Size the mint so the FULL deposit (× leverage) is actually spent. Each Predict
  // unit pays $1 if it wins and costs ~its probability now (well under 1 DUSDC), so
  // minting `amountMicro` units would only spend ~half the deposit and leave the rest
  // idle in the manager — which made cash-outs look tiny. Instead solve
  // quantity = deposit / price. `pricePerUnit` is the on-chain probability (0–1):
  // mintCost(DUSDC) ÷ units(amountMicro/1e6). The SIZE_BUFFER is the real
  // headroom between the position's quoted cost and the deposit: near the money
  // the per-contract price swings fast, so the quote (seconds old) can drift up
  // before execution. 0.92 → the deposit covers the mint even after an ~8% cost
  // drift; the unused remainder stays in the user's balance, reusable.
  const SIZE_BUFFER = 0.92;
  // When leveraged, the reserve fronts (L-1)× the margin and skims a premium, so the
  // capital actually deployed into the position is margin×L − premium, not margin×L.
  const premiumBps = reserveStats?.premiumBps ?? 800;
  const frontedMicro = Math.floor(amountMicro * (leverage - 1));
  const premiumMicro = Math.floor((frontedMicro * premiumBps) / 10_000);
  const notionalMicro = amountMicro * leverage - premiumMicro;
  const pricePerUnit = onChainQuote && amountMicro > 0
    ? (onChainQuote.mintCost * DUSDC_MULTIPLIER) / amountMicro
    : 0;
  const positionQty = pricePerUnit > 0
    ? Math.max(1, Math.floor((notionalMicro * SIZE_BUFFER) / pricePerUnit))
    : amountMicro;
  const maxCollectMicro = isLeveraged
    ? Math.max(0, positionQty - frontedMicro)
    : positionQty;
  const maxProfitMicro = maxCollectMicro - amountMicro;
  const maintenanceBufferMicro = Math.max(20_000, Math.floor(frontedMicro * 0.1));
  const keeperFeeMicro = 10_000;
  const liquidationWatchMicro = frontedMicro + maintenanceBufferMicro + keeperFeeMicro;
  const needsLiveQuote = isValidAmount && isRangeValid && selectedStrike !== null;
  const hasLiveQuote = !needsLiveQuote || (!!onChainQuote && !quoteLoading && !quoteError);
  const askOutOfBounds = hasLiveQuote && pricePerUnit > 0 && (pricePerUnit < MIN_MINT_ASK || pricePerUnit > MAX_MINT_ASK);
  const leveragedRightSideLosesMoney = isLeveraged && hasLiveQuote && maxCollectMicro <= amountMicro;
  const tradeRiskBlocked = askOutOfBounds || leveragedRightSideLosesMoney;
  const privateRouteIssue = privacyMode !== 'private'
    ? ''
    : side === 'RANGE'
      ? 'Private mode supports UP/DOWN binary bets first.'
      : leverage > 1
        ? 'Private mode is not available for leveraged trades yet.'
        : privateStatus.maxStakeDusdc && amountMicro > privateStatus.maxStakeDusdc * DUSDC_MULTIPLIER
          ? `Private beta max is ${privateStatus.maxStakeDusdc.toFixed(2)} DUSDC per ticket.`
        : !privateStatus.ready
          ? privateStatus.reasons[0] ?? 'Private route is not ready.'
          : '';
  const privateRouteReady = privacyMode === 'public' || privateRouteIssue === '';
  const privateRouteButtonLabel = privateRouteIssue.startsWith('Private beta max')
    ? privateRouteIssue.replace(' per ticket.', '')
    : 'Private route not ready';
  // Estimated cost of the sized position (per-unit price read on-chain × our quantity).
  const estTradeCost = pricePerUnit > 0
    ? (positionQty * pricePerUnit) / DUSDC_MULTIPLIER
    : (onChainQuote?.mintCost ?? 0);

  const handleTrade = useCallback(async () => {
    if (!address || !selectedStrike || !isValidAmount || !isRangeValid) return;
    // Fresh re-check at trade time: never send a mint that will abort because the round
    // just closed (the dominant intermittent failure on a 15-min round).
    if (Date.now() >= Number(oracle.expiry) - CLOSING_MARGIN_MS) {
      setShowConfirmModal(false);
      setErrorMsg('This round just closed — pick the next bell.');
      return;
    }
    if (askOutOfBounds) {
      setShowConfirmModal(false);
      setErrorMsg('This price is outside DeepBook Predict mint bounds — pick a less certain line or the other side.');
      setStep('error');
      return;
    }
    if (leveragedRightSideLosesMoney) {
      setShowConfirmModal(false);
      setErrorMsg('Leverage is not safe on this price — even a win would collect less than your margin. Use 1x or pick a less certain line.');
      setStep('error');
      return;
    }

    setErrorMsg('');
    setTxDigest('');
    setIsTwoStep(leverage === 1 && !manager?.manager_id);

    try {
      let managerId = manager?.manager_id;
      let digest = '';

      if (privacyMode === 'private') {
        if (privateRouteIssue) throw new Error(privateRouteIssue);
        if (side === 'RANGE') throw new Error('Private mode supports UP/DOWN binary bets first.');

        setStep('minting');
        const ticket = await openPrivateBet({
          owner: address,
          oracleId: oracle.oracle_id,
          expiry: oracle.expiry,
          strike: selectedStrike,
          side,
          stakeMicro: amountMicro,
          quantity: positionQty,
          maxCostDusdc: estTradeCost || amountMicro / DUSDC_MULTIPLIER,
        }, privateStatus);
        digest = ticket.digest;
        setTxDigest(digest);

        const allTickets = loadPrivateBetTickets();
        const nextAll = [ticket, ...allTickets.filter((t) => t.digest !== ticket.digest)];
        savePrivateBetTickets(nextAll);
        setPrivateTickets(nextAll.filter((t) => t.owner.toLowerCase() === address.toLowerCase()));

        setStep('success');
        onSuccess?.();
        toast(
          `Private bet opened: ${ticket.side} ${oracle.underlying_asset || 'BTC'} at ${(ticket.strike / FLOAT_SCALING).toLocaleString()} via session route.`,
          'success',
        );
        setTimeout(() => {
          setStep('idle');
          setAmount('10');
        }, 6000);
        return;
      }

      // Step 1: Create manager if needed (leveraged trades use the keeper's manager,
      // so they don't need the trader to have one).
      if (!managerId && leverage === 1) {
        setStep('creating-manager');
        await submit(() => createManagerTx());
        await refreshManager();
        const { fetchManagerForAddress } = await import('@/lib/sui/predictApi');
        const m = await fetchManagerForAddress(address);
        if (!m) throw new Error('Failed to create manager');
        managerId = m.manager_id;
      }

      if (leverage > 1) {
        // Leveraged via TradingVault: the user pre-funds once, then the vault
        // escrows margin into the borrow-and-liquidate desk. If the vault is
        // short, this PTB tops it up from wallet first.
        const vaultAvailable = BigInt(tradingVaultBalance.available);
        const needsTopUp = vaultAvailable < BigInt(amountMicro);
        if (needsTopUp && coins.length === 0) {
          throw new Error('Add DUSDC to your wallet or Trading Balance before opening leverage.');
        }
        setStep('minting');
        const coinIds = coins.map(c => c.coinObjectId);
        const margin = BigInt(amountMicro);
        const leverageBps = BigInt(leverage * 10_000);
        ({ digest } = await submit(() => side === 'RANGE' && rangeUpperStrike
          ? fundAndOpenTradingBalanceRangeLeverageTx({
              coinIds, vaultAvailableAmount: vaultAvailable, marginAmount: margin, leverageBps,
              oracleId: oracle.oracle_id, expiry: BigInt(oracle.expiry),
              lower: BigInt(selectedStrike), higher: BigInt(rangeUpperStrike),
            })
          : fundAndOpenTradingBalanceBinaryLeverageTx({
              coinIds, vaultAvailableAmount: vaultAvailable, marginAmount: margin, leverageBps,
              oracleId: oracle.oracle_id, expiry: BigInt(oracle.expiry),
              strike: BigInt(selectedStrike), isUp: side === 'UP',
            })));
        setTxDigest(digest);
        recordLocalLeverageOrder({
          txDigest: digest,
          trader: address,
          margin: amountMicro / DUSDC_MULTIPLIER,
          leverage,
          oracleId: oracle.oracle_id,
          expiry: oracle.expiry,
          isRange: side === 'RANGE',
          isUp: side === 'UP',
          lowerStrike: selectedStrike,
          higherStrike: rangeUpperStrike ?? 0,
          createdAt: Date.now(),
        });
      } else {
        if (!managerId) throw new Error('No trading account.');
        const vaultAvailable = BigInt(tradingVaultBalance.available);
        const needsTopUp = vaultAvailable < BigInt(amountMicro);
        if (needsTopUp && coins.length === 0) {
          throw new Error('Add DUSDC to your wallet or Trading Balance before trading.');
        }

        if (side === 'RANGE' && rangeUpperStrike) {
          setStep('minting');
          const coinIds = coins.map(c => c.coinObjectId);
          ({ digest } = await submit(() => tradingBalanceDepositAndMintRangeTx(
            managerId!,
            coinIds,
            vaultAvailable,
            BigInt(amountMicro),
            oracle.oracle_id,
            BigInt(oracle.expiry),
            BigInt(selectedStrike),
            BigInt(rangeUpperStrike),
            BigInt(positionQty),
          )));
          setTxDigest(digest);
        } else {
          setStep('minting');
          const coinIds = coins.map(c => c.coinObjectId);
          ({ digest } = await submit(() => tradingBalanceDepositAndMintTx(
            managerId!,
            coinIds,
            vaultAvailable,
            BigInt(amountMicro),
            oracle.oracle_id,
            BigInt(oracle.expiry),
            BigInt(selectedStrike),
            side as 'UP' | 'DOWN',
            BigInt(positionQty),
          )));
          setTxDigest(digest);
        }
      }

      // Leveraged positions are settled via /earn (which repays the reserve its
      // fronted capital). Don't record them in the normal local store, or they'd
      // also surface a plain Portfolio "Claim" that would bypass that repayment.
      if (leverage === 1) {
        savePosition({
          oracleId: oracle.oracle_id,
          expiry: oracle.expiry,
          strike: selectedStrike,
          direction: side === 'RANGE' ? 'UP' : side,
          quantity: positionQty,
          cost: amountMicro,
          timestamp: Date.now(),
          txDigest: digest,
        });
      }

      setStep('success');
      refreshBalance();
      refreshManagerBalance();
      refreshTradingVaultBalance();
      onSuccess?.();
      const strikeLabel = selectedStrike ? `$${(selectedStrike / FLOAT_SCALING).toLocaleString()}` : '';
      toast(
        leverage > 1
          ? `${leverage}× order placed — the keeper is opening your position (a few seconds). Track it on Earn.`
          : `Position opened: ${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC on ${oracle.underlying_asset || 'BTC'} ${side} ${strikeLabel}`,
        'success',
      );

      setTimeout(() => {
        setStep('idle');
        setAmount('10');
      }, 6000);
    } catch (err: unknown) {
      console.error('Trade error:', err);
      setStep('error');
      const friendly = humanizeTxError(err);
      setErrorMsg(friendly.title);
      setErrorDetail(friendly.detail);
      toast(friendly.title, 'error');
    }
  }, [
    address, selectedStrike, rangeUpperStrike, isValidAmount, isRangeValid, manager,
    amountMicro, positionQty, coins, oracle, side, submit, leverage, tradingVaultBalance.available,
    refreshManager, refreshBalance, refreshManagerBalance, refreshTradingVaultBalance, onSuccess, privacyMode,
    privateRouteIssue, privateStatus, estTradeCost, toast, askOutOfBounds, leveragedRightSideLosesMoney,
  ]);

  const handlePrivateCashout = useCallback(async (ticket: PrivateBetTicket) => {
    if (step !== 'idle') return;
    setStep('minting');
    setErrorMsg('');
    setTxDigest('');
    try {
      const updated = await cashOutPrivateBet(ticket, privateStatus);
      const allTickets = loadPrivateBetTickets();
      const nextAll = allTickets.map((t) => (t.digest === updated.digest ? updated : t));
      savePrivateBetTickets(nextAll);
      setPrivateTickets(nextAll.filter((t) => t.owner.toLowerCase() === ticket.owner.toLowerCase()));
      setTxDigest(updated.cashoutDigest ?? '');
      setStep('success');
      toast('Private cashout credited to your Private Balance.', 'success');
      setTimeout(() => setStep('idle'), 5000);
    } catch (err: unknown) {
      setStep('error');
      const friendly = humanizeTxError(err);
      setErrorMsg(friendly.title);
      setErrorDetail(friendly.detail);
      toast(friendly.title, 'error');
    }
  }, [privateStatus, step, toast]);

  const handlePrivateWithdraw = useCallback(async (mode: PrivateWithdrawMode) => {
    if (!address || step !== 'idle') return;
    setStep('minting');
    setErrorMsg('');
    setTxDigest('');
    try {
      const updatedTickets = await withdrawPrivateBalance(address, privateTickets, privateStatus, mode);
      const updatedByDigest = new Map(updatedTickets.map((ticket) => [ticket.digest, ticket]));
      const allTickets = loadPrivateBetTickets();
      const nextAll = allTickets.map((ticket) => updatedByDigest.get(ticket.digest) ?? ticket);
      savePrivateBetTickets(nextAll);
      setPrivateTickets(nextAll.filter((ticket) => ticket.owner.toLowerCase() === address.toLowerCase()));
      const withdrawDigest = updatedTickets.find((ticket) => ticket.withdrawDigest)?.withdrawDigest ?? '';
      setTxDigest(withdrawDigest);
      setStep('success');
      toast(
        mode === 'private'
          ? 'Private Balance withdrawn through the separated beta route.'
          : 'Private Balance withdrawn to your connected wallet.',
        'success',
      );
      setTimeout(() => setStep('idle'), 5000);
    } catch (err: unknown) {
      setStep('error');
      const friendly = humanizeTxError(err);
      setErrorMsg(friendly.title);
      setErrorDetail(friendly.detail);
      toast(friendly.title, 'error');
    }
  }, [address, privateTickets, privateStatus, step, toast]);

  const quickAmounts = [5, 10, 25, 50, 100];
  const strikeDollars = selectedStrike ? selectedStrike / FLOAT_SCALING : 0;
  const upperStrikeDollars = rangeUpperStrike ? rangeUpperStrike / FLOAT_SCALING : 0;

  if (!address) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-neutral-900/60 p-6 text-center">
        <Wallet className="w-8 h-8 text-gray-600 mx-auto mb-3" />
        <p className="text-sm text-gray-400 mb-1">Connect your wallet to trade</p>
        <p className="text-xs text-gray-600 mb-4">Any Sui wallet — test funds are free</p>
        <div className="flex justify-center"><ConnectButton /></div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-neutral-900/60 overflow-hidden">
      {/* Mode toggle — Simple (plain question) vs Pro (full machinery) */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-white/5">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600">Place a bet</span>
        <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.02] p-0.5">
          {(['simple', 'pro'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => applyMode(m)}
              aria-pressed={mode === m}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-colors ${
                mode === m ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {m === 'simple' ? 'Simple' : 'Pro'}
            </button>
          ))}
        </div>
      </div>
      {/* Side selector (Pro: Up / Down / Range tabs) */}
      {mode === 'pro' && (
      <div className="flex border-b border-white/5">
        <button
          type="button"
          onClick={() => { setSide('UP'); onSideChange?.('UP'); }}
          aria-pressed={side === 'UP'}
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
          type="button"
          onClick={() => { setSide('DOWN'); onSideChange?.('DOWN'); }}
          aria-pressed={side === 'DOWN'}
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
          type="button"
          onClick={() => setSide('RANGE')}
          aria-pressed={side === 'RANGE'}
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
      )}

      <div className="p-5 space-y-4">
        {/* Bet builder — Simple shows a plain question; Pro shows strikes/range */}
        {mode === 'simple' ? (
          <div className="space-y-3">
            {/* Plain-English question — no "strike", price baked in and pre-set */}
            <div className="rounded-xl bg-white/[0.02] border border-white/5 px-4 py-3.5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-gray-600 font-bold mb-1.5">The call</p>
              <p className="text-[15px] leading-snug text-gray-200">
                Will {oracle.underlying_asset || 'Bitcoin'} be{' '}
                <span className={side === 'UP' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {side === 'UP' ? 'above' : 'below'}
                </span>{' '}
                <button
                  type="button"
                  onClick={() => setShowStrikeSelector((s) => !s)}
                  className="text-white font-bold font-mono underline decoration-dotted decoration-white/40 underline-offset-4 hover:decoration-white transition-colors"
                >
                  {selectedStrike ? `$${(selectedStrike / FLOAT_SCALING).toLocaleString()}` : '—'}
                </button>{' '}
                when the bell rings?
              </p>
            </div>

            {/* Higher / Lower — plain words, with the implied chance for each side */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setSide('UP'); onSideChange?.('UP'); }}
                aria-pressed={side === 'UP'}
                className={`flex flex-col items-center gap-0.5 py-3 rounded-xl border transition-all ${
                  side === 'UP'
                    ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-400'
                    : 'border-white/5 bg-white/[0.02] text-gray-400 hover:text-white hover:border-white/10'
                }`}
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-bold"><TrendingUp className="w-4 h-4" /> Higher</span>
                {upProb !== null && <span className="text-[10px] font-mono opacity-70">~{Math.round(upProb * 100)}% chance</span>}
              </button>
              <button
                type="button"
                onClick={() => { setSide('DOWN'); onSideChange?.('DOWN'); }}
                aria-pressed={side === 'DOWN'}
                className={`flex flex-col items-center gap-0.5 py-3 rounded-xl border transition-all ${
                  side === 'DOWN'
                    ? 'border-rose-400/60 bg-rose-500/10 text-rose-400'
                    : 'border-white/5 bg-white/[0.02] text-gray-400 hover:text-white hover:border-white/10'
                }`}
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-bold"><TrendingDown className="w-4 h-4" /> Lower</span>
                {upProb !== null && <span className="text-[10px] font-mono opacity-70">~{Math.round((1 - upProb) * 100)}% chance</span>}
              </button>
            </div>

            {/* Progressive disclosure: change the price (gentle, NOT the full ladder) */}
            <button
              type="button"
              onClick={() => setShowStrikeSelector((s) => !s)}
              aria-expanded={showStrikeSelector}
              className="text-[11px] font-bold text-gray-500 hover:text-white transition-colors"
            >
              {showStrikeSelector ? 'Done' : 'Change the price'} ▾
            </button>
            <AnimatePresence>
              {showStrikeSelector && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3 space-y-2.5">
                    <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-black/30 border border-white/10 focus-within:border-white/25 transition-colors">
                      <span className="text-gray-500 font-mono text-lg">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={strikeInput}
                        onChange={(e) => setStrikeInput(e.target.value.replace(/[^0-9.,]/g, ''))}
                        onBlur={() => commitStrike(parseFloat(strikeInput.replace(/,/g, '')))}
                        onKeyDown={(e) => { if (e.key === 'Enter') { commitStrike(parseFloat(strikeInput.replace(/,/g, ''))); e.currentTarget.blur(); } }}
                        aria-label="Target price"
                        className="flex-1 min-w-0 bg-transparent outline-none text-white font-mono font-bold text-lg tabular-nums"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      {(forwardPrice || spotPrice) && (
                        <button type="button" onClick={() => commitStrike((forwardPrice || spotPrice)! / FLOAT_SCALING)} className="flex-1 py-1.5 text-[10px] font-bold rounded-lg border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white transition-colors">Now</button>
                      )}
                      {(forwardPrice || spotPrice) && (
                        <button type="button" onClick={() => commitStrike(Math.round(((forwardPrice || spotPrice)! / FLOAT_SCALING) / 1000) * 1000)} className="flex-1 py-1.5 text-[10px] font-bold rounded-lg border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white transition-colors">Round</button>
                      )}
                      <button type="button" disabled={!selectedStrike} onClick={() => selectedStrike && commitStrike(selectedStrike / FLOAT_SCALING - 1000)} className="flex-1 py-1.5 text-[10px] font-bold rounded-lg border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white transition-colors disabled:opacity-40">−$1k</button>
                      <button type="button" disabled={!selectedStrike} onClick={() => selectedStrike && commitStrike(selectedStrike / FLOAT_SCALING + 1000)} className="flex-1 py-1.5 text-[10px] font-bold rounded-lg border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white transition-colors disabled:opacity-40">+$1k</button>
                    </div>
                    <p className="text-[10px] text-gray-600 leading-snug">Closer to today&apos;s price is safer but pays less. A bigger move pays more.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : side === 'RANGE' ? (
          <div className="grid grid-cols-2 gap-3">
            {/* Lower strike */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-2">
                Lower Strike
              </label>
              <button
                type="button"
                onClick={() => { setShowStrikeSelector(!showStrikeSelector); setShowUpperStrikeSelector(false); }}
                aria-expanded={showStrikeSelector}
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
                type="button"
                onClick={() => { setShowUpperStrikeSelector(!showUpperStrikeSelector); setShowStrikeSelector(false); }}
                aria-expanded={showUpperStrikeSelector}
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
                    {displayedStrikes.map((strike) => {
                      const dollars = strike / FLOAT_SCALING;
                      const isSelected = strike === selectedStrike;
                      return (
                        <button
                          key={strike}
                          type="button"
                          onClick={() => { chooseStrike(strike); setShowStrikeSelector(false); }}
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
                    {displayedStrikes.filter(s => !selectedStrike || s > selectedStrike).map((strike) => {
                      const dollars = strike / FLOAT_SCALING;
                      const isSelected = strike === rangeUpperStrike;
                      return (
                        <button
                          key={strike}
                          type="button"
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
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
                Your line
              </label>
              <button
                type="button"
                onClick={() => setShowStrikeSelector(!showStrikeSelector)}
                aria-expanded={showStrikeSelector}
                className="text-[10px] font-bold text-gray-500 hover:text-white transition-colors"
              >
                all strikes ▾
              </button>
            </div>
            {/* Continuous strike — type ANY price; snaps to the protocol grid on commit */}
            <div className="flex items-center gap-1.5 px-3 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] focus-within:border-white/25 transition-colors">
              <span className="text-gray-500 font-mono text-lg">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={strikeInput}
                onChange={(e) => setStrikeInput(e.target.value.replace(/[^0-9.,]/g, ''))}
                onBlur={() => commitStrike(parseFloat(strikeInput.replace(/,/g, '')))}
                onKeyDown={(e) => { if (e.key === 'Enter') { commitStrike(parseFloat(strikeInput.replace(/,/g, ''))); e.currentTarget.blur(); } }}
                aria-label="Strike price"
                className="flex-1 min-w-0 bg-transparent outline-none text-white font-mono font-bold text-lg tabular-nums"
              />
            </div>
            {/* quick chips */}
            <div className="flex gap-1.5 mt-2">
              {(forwardPrice || spotPrice) && (
                <button type="button" onClick={() => commitStrike((forwardPrice || spotPrice)! / FLOAT_SCALING)} className="flex-1 py-1.5 text-[10px] font-bold rounded-lg border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white transition-colors">Spot</button>
              )}
              {(forwardPrice || spotPrice) && (
                <button type="button" onClick={() => commitStrike(Math.round(((forwardPrice || spotPrice)! / FLOAT_SCALING) / 1000) * 1000)} className="flex-1 py-1.5 text-[10px] font-bold rounded-lg border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white transition-colors">Round</button>
              )}
              <button type="button" disabled={!selectedStrike} onClick={() => selectedStrike && commitStrike(selectedStrike / FLOAT_SCALING - 1000)} className="flex-1 py-1.5 text-[10px] font-bold rounded-lg border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white transition-colors disabled:opacity-40">−$1k</button>
              <button type="button" disabled={!selectedStrike} onClick={() => selectedStrike && commitStrike(selectedStrike / FLOAT_SCALING + 1000)} className="flex-1 py-1.5 text-[10px] font-bold rounded-lg border border-white/5 bg-white/[0.02] text-gray-400 hover:text-white transition-colors disabled:opacity-40">+$1k</button>
            </div>
            {/* price-to-beat framing — keeps the binary mental model legible */}
            {selectedStrike && (
              <p className="text-[11px] text-gray-500 mt-2 leading-snug">
                {oracle.underlying_asset || 'BTC'} must close{' '}
                <span className={side === 'UP' ? 'text-new-mint' : 'text-rose-400'}>{side === 'UP' ? 'above' : 'below'}</span>{' '}
                <span className="text-white font-mono">{formatStrike(selectedStrike)}</span> at the bell
              </p>
            )}

            <AnimatePresence>
              {showStrikeSelector && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-white/[0.08] bg-black/40 scrollbar-hide">
                    {displayedStrikes.map((strike) => {
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
                          type="button"
                          onClick={() => {
                            chooseStrike(strike);
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
              {mode === 'simple' ? 'Your stake' : 'Amount (DUSDC)'}
            </label>
            <span className="text-[10px] text-gray-600">
              {mode === 'simple'
                ? `Trading: ${(tradingVaultBalance.available / DUSDC_MULTIPLIER).toFixed(2)} | Wallet: ${(walletBalance / DUSDC_MULTIPLIER).toFixed(2)}`
                : `Wallet: ${(walletBalance / DUSDC_MULTIPLIER).toFixed(2)} | Trading: ${(tradingVaultBalance.available / DUSDC_MULTIPLIER).toFixed(2)}`}
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
                type="button"
                onClick={() => setAmount(String(qa))}
                aria-pressed={amount === String(qa)}
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

        {/* Leverage (yolev underwriting reserve) — Pro only */}
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
              Privacy
            </label>
            <span className={`font-mono text-[10px] ${privateStatus.ready ? 'text-new-mint' : 'text-gray-600'}`}>
              {privateStatus.label}
            </span>
          </div>
          <IncognitoToggle mode={privacyMode} onChange={applyPrivacyMode} />
          {privacyMode === 'private' && (
            <div className="rounded-xl bg-new-mint/[0.04] border border-new-mint/15 p-3">
              <div className="flex items-start gap-2">
                {privateStatus.ready ? (
                  <ShieldCheck className="w-4 h-4 text-new-mint mt-0.5 shrink-0" />
                ) : (
                  <LockKeyhole className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                )}
                <p className="text-[11px] leading-relaxed text-gray-400">
                  {privateStatus.mode === 'unconfigured'
                    ? 'The private route is offline right now — try again shortly.'
                    : 'Your wallet stays off this trade. Winnings land in your Private Balance, and you choose when to withdraw.'}
                </p>
              </div>
              {privateRouteIssue && (
                <p className="text-[11px] text-rose-400 leading-relaxed mt-2">{privateRouteIssue}</p>
              )}
            </div>
          )}
        </div>

        {mode === 'pro' && (
        <div className="mt-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-500 text-xs inline-flex items-center gap-1">
              Boost <span className="text-[8px] font-bold uppercase tracking-wider text-new-mint/80 bg-new-mint/10 px-1 py-0.5 rounded">margin</span>
              <Tooltip text="Boost increases your market exposure from the DUSDC you choose. Your max loss stays your margin; live cashout value determines health." position="bottom" />
            </span>
            <span className="font-mono text-xs text-white">{leverage}×</span>
          </div>
          <div className="flex gap-2">
            {[1, 2, 3].map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLeverage(l)}
                aria-pressed={leverage === l}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                  leverage === l ? 'border-vermilion/50 bg-vermilion/10 text-vermilion' : 'border-white/5 bg-white/[0.02] text-gray-500 hover:text-gray-300'
                }`}
              >
                {l}×
              </button>
            ))}
          </div>
          {leverage > 1 && isValidAmount && (
            <div className="mt-2 rounded-xl bg-new-mint/[0.035] border border-new-mint/12 px-3 py-3 space-y-2 text-xs">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gray-500">Your boost</div>
                  <div className="mt-1 font-mono text-white text-sm">
                    {(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC at {leverage}×
                  </div>
                </div>
                <span className="rounded-full bg-white text-black px-2.5 py-1 font-mono text-[10px] font-bold">
                  {(amountMicro * leverage / DUSDC_MULTIPLIER).toFixed(2)} exposure
                </span>
              </div>
              <div className="h-px bg-white/5" />
              <div className="flex justify-between"><span className="text-gray-500">You use</span><span className="font-mono text-white">{(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Market exposure</span><span className="font-mono text-new-mint">{(amountMicro * leverage / DUSDC_MULTIPLIER).toFixed(2)} DUSDC</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Est. collect if right</span><span className="font-mono text-new-mint">{hasLiveQuote && onChainQuote ? `${(maxCollectMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC` : 'quoting'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Est. profit if right</span><span className={`font-mono ${maxProfitMicro >= 0 ? 'text-new-mint' : 'text-rose-400'}`}>{hasLiveQuote && onChainQuote ? `${maxProfitMicro >= 0 ? '+' : ''}${(maxProfitMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC` : 'quoting'}</span></div>
              <div className="h-px bg-white/5" />
              <div className="flex justify-between"><span className="text-gray-500">Max loss</span><span className="font-mono text-white">{(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Auto-cashout watch</span><span className="font-mono text-gray-300">{(liquidationWatchMicro / DUSDC_MULTIPLIER).toFixed(2)} live value</span></div>
              <details className="group rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500 group-open:text-gray-300">
                  Reserve details
                </summary>
                <div className="mt-2 space-y-1.5 border-t border-white/5 pt-2">
                  <div className="flex justify-between"><span className="text-gray-500">Reserve fronts</span><span className="font-mono text-white">{(frontedMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC</span></div>
                  <div className="flex justify-between"><span className="text-gray-500 inline-flex items-center gap-1">Premium <Tooltip text="One-time fee paid to the reserve for fronting the boost." position="bottom" /></span><span className="font-mono text-white">{(premiumMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Net deployed</span><span className="font-mono text-white">{(notionalMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC</span></div>
                </div>
              </details>
            </div>
          )}
        </div>
        )}

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
          {/* "Your line" intentionally omitted here — it just repeats the strike
              selector above. Keep the summary to numbers the bettor can't see
              elsewhere: pay, win, odds, countdown. */}
          {/* The only two numbers a bettor needs: what you pay, what you win.
              "You pay" = the amount you chose (what leaves your wallet). The
              position is sized to use it; any sub-unit remainder stays in your
              balance, reusable — never a hidden deduction. */}
          {/* Earnings hero — the one number a consumer actually cares about. */}
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-400/70">
              {isLeveraged ? 'You could collect' : 'You could win'}
            </div>
            {quoteLoading ? (
              <div className="font-display text-3xl font-extrabold text-emerald-400/50 mt-1.5">…</div>
            ) : isValidAmount && onChainQuote ? (
              <>
                <div className="font-display text-[34px] leading-none font-extrabold text-emerald-400 tabular-nums mt-1.5">
                  {(maxCollectMicro / DUSDC_MULTIPLIER).toFixed(2)} <span className="text-xl">DUSDC</span>
                </div>
                <div className="font-mono text-[11px] text-gray-400 mt-2">
                  {(() => {
                    const pay = amountMicro / DUSDC_MULTIPLIER;
                    const win = maxCollectMicro / DUSDC_MULTIPLIER;
                    const profit = isLeveraged ? maxProfitMicro / DUSDC_MULTIPLIER : win - pay;
                    const mult = win / Math.max(0.0001, pay);
                    return <>+{profit.toFixed(2)} profit · {mult.toFixed(2)}× if you&apos;re right</>;
                  })()}
                </div>
              </>
            ) : quoteError ? (
              <button onClick={() => setQuoteRetry((k) => k + 1)} className="mt-2 text-[12px] text-rose-400/90 underline underline-offset-2 hover:text-rose-300">
                quote unavailable — retry
              </button>
            ) : (
              <div className="font-display text-3xl font-extrabold text-gray-700 mt-1.5">—</div>
            )}
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-gray-500 text-xs inline-flex items-center gap-1">
              {isLeveraged ? 'Your margin' : 'You pay'}
              <Tooltip text={isLeveraged ? 'The DUSDC you put at risk. Boost adds exposure, but your max loss stays this margin.' : "What leaves your wallet for this bet. Anything your position doesn't use stays in your balance for next time."} position="bottom" />
            </span>
            <span className="text-white font-mono font-bold text-base">
              {isValidAmount ? `${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC` : '—'}
            </span>
          </div>
          {askOutOfBounds && (
            <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">
              This side is priced outside DeepBook Predict&apos;s mint range. Pick a less certain strike or take the other side.
            </div>
          )}
          {leveragedRightSideLosesMoney && (
            <div className="rounded-lg border border-rose-500/15 bg-rose-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-rose-200/80">
              Leverage is disabled here because a correct trade would collect less than your margin after reserve repayment.
            </div>
          )}
          <div className="flex justify-between text-xs pt-1">
            <span className="text-gray-500">Expires in</span>
            <span className="text-white">
              <Countdown expiryMs={oracle.expiry} className="text-xs" />
            </span>
          </div>

          {/* Win chance + the verifiable price check are detail a consumer doesn't need —
              the earnings hero already says what they'd win. Keep them for Pro mode (and
              judges), where the "verified on-chain" moat is worth showing. */}
          {mode === 'pro' && feeBreakdown && (
            <div className="py-2 border-t border-white/5 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500 inline-flex items-center gap-1">
                  Win chance
                  <Tooltip text="The market's estimate of how likely your side is to win — fees included." position="bottom" />
                </span>
                <span className="text-white font-mono">{(feeBreakdown.fairPrice * 100).toFixed(0)}%</span>
              </div>
              {/* Verify: re-derive the price in the browser from the public vol
                  surface and check it against the live on-chain quote. The moat,
                  demonstrated — not claimed. */}
              {onChainQuote && pricePerUnit > 0 && (() => {
                const deltaCents = Math.abs(pricePerUnit - feeBreakdown.totalCostPerUnit) * 100;
                const matches = deltaCents < 1;
                return (
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-500 inline-flex items-center gap-1">
                      Price check
                      <Tooltip text={`We re-derive this price in your browser from the public volatility surface (SVI → N(d2)) and compare it to the live on-chain quote — math you can reproduce, not a number to trust. Browser ${(feeBreakdown.totalCostPerUnit * 100).toFixed(1)}¢ · chain ${(pricePerUnit * 100).toFixed(1)}¢.`} position="bottom" />
                    </span>
                    <span className={`inline-flex items-center gap-1.5 font-mono ${matches ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {matches ? <><Check className="w-3 h-3" /> verified on-chain</> : 'recheck'}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Execute button */}
        <button
          type="button"
          onClick={() => {
            if (roundClosing) { setErrorMsg('This round just closed — pick the next bell.'); return; }
            if (askOutOfBounds) { setErrorMsg('This price is outside DeepBook Predict mint bounds — pick a less certain line or the other side.'); setStep('error'); return; }
            if (leveragedRightSideLosesMoney) { setErrorMsg('Leverage is not safe on this price — even a win would collect less than your margin. Use 1x or pick a less certain line.'); setStep('error'); return; }
            setShowConfirmModal(true);
          }}
          disabled={!isValidAmount || !selectedStrike || step !== 'idle' || !hasEnoughBalance || !isRangeValid || stopHit || !hasLiveQuote || !privateRouteReady || roundClosing || tradeRiskBlocked}
          className={`w-full py-4 rounded-xl text-sm font-bold uppercase tracking-wider transition-all disabled:cursor-not-allowed ${
            // Success is ALWAYS green — never inherit the DOWN-red, or a confirmed trade
            // reads as an error (a red "TRADE CONFIRMED!" looks like a failure).
            step === 'success'
              ? 'bg-emerald-500 text-black shadow-[0_0_24px_rgba(16,185,129,0.3)]'
            // Blocked (no balance / no amount / stop hit) → neutral grey, NOT the
            // buy-green: an error state must never wear the success colour.
            : (!isValidAmount || !hasEnoughBalance || !isRangeValid || stopHit || tradeRiskBlocked) && step === 'idle'
              ? 'bg-white/[0.06] text-gray-400 border border-white/10'
              : side === 'UP'
                ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_20px_rgba(16,185,129,0.2)] disabled:opacity-50'
                : side === 'DOWN'
                  ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-[0_0_20px_rgba(244,63,94,0.2)] disabled:opacity-50'
                  : 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)] disabled:opacity-50'
          }`}
        >
          {step === 'creating-manager' ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Placing your bet…
            </span>
          ) : step === 'depositing' ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Depositing...
            </span>
          ) : step === 'minting' ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Placing your bet…
            </span>
          ) : step === 'success' ? (
            <span className="flex items-center justify-center gap-2">
              <Check className="w-4 h-4" />
              Trade confirmed!
            </span>
          ) : roundClosing ? (
            'This round just closed — pick the next bell'
          ) : askOutOfBounds ? (
            'Price outside mint range'
          ) : leveragedRightSideLosesMoney ? (
            'Use 1x — leverage loses even if right'
          ) : stopHit ? (
            'Daily stop hit — back tomorrow'
          ) : !isValidAmount ? (
            'Enter amount'
          ) : !hasEnoughBalance ? (
            isLeveraged ? 'Insufficient wallet DUSDC' : 'Insufficient DUSDC'
          ) : !hasLiveQuote ? (
            quoteLoading ? 'Quoting...' : 'Quote unavailable'
          ) : !privateRouteReady ? (
            privateRouteButtonLabel
          ) : !isRangeValid ? (
            'Select valid range'
          ) : privacyMode === 'private' ? (
            `Private bet ${side === 'UP' ? 'Higher' : 'Lower'} — ${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC`
          ) : side === 'RANGE' ? (
            `Buy Range — ${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC`
          ) : isLeveraged ? (
            `Open ${leverage}x Boost — ${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC`
          ) : mode === 'simple' ? (
            `Bet ${side === 'UP' ? 'Higher' : 'Lower'} — ${(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC`
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

        {/* Success confirmation — visible, animated, with the win condition + payout */}
        <AnimatePresence>
          {step === 'success' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              className="rounded-xl border border-new-mint/25 bg-new-mint/[0.06] p-4 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.05, type: 'spring', stiffness: 420, damping: 15 }}
                className="w-9 h-9 mx-auto mb-2 rounded-full bg-new-mint/15 flex items-center justify-center"
              >
                <Check className="w-5 h-5 text-new-mint" />
              </motion.div>
              {isLeveraged ? (
                <>
                  <p className="text-sm font-bold text-white">{leverage}× order placed</p>
                  <p className="text-xs text-gray-400 mt-1">
                    The keeper is opening your position — track it on{' '}
                    <a href="/earn" className="text-new-mint hover:underline">Earn</a>.
                  </p>
                </>
              ) : privacyMode === 'private' ? (
                <>
                  <p className="text-sm font-bold text-white">Private ticket opened</p>
                  <p className="text-xs text-gray-400 mt-1">
                    A session manager opens the public Predict position; cashout will credit your Private Balance.
                  </p>
                  {txDigest && (
                    <p className="text-xs text-new-mint mt-1">
                      Ticket {txDigest.slice(0, 6)}...{txDigest.slice(-4)}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-white">Position opened</p>
                  <p className="text-xs text-gray-300 mt-1">
                    {side} · {(amountMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC on {oracle.underlying_asset || 'BTC'}
                  </p>
                  {positionQty > 0 && (
                    <p className="text-xs text-new-mint mt-1">
                      Wins {(positionQty / DUSDC_MULTIPLIER).toFixed(2)} DUSDC if {oracle.underlying_asset || 'BTC'}{' '}
                      {side === 'UP' ? 'is above' : side === 'DOWN' ? 'is below' : 'settles in range of'}{' '}
                      {selectedStrike ? `$${(selectedStrike / FLOAT_SCALING).toLocaleString()}` : 'the line'} at the bell
                    </p>
                  )}
                </>
              )}
              <div className="flex items-center justify-center gap-4 mt-3">
                {txDigest && (
                  <a
                    href={`https://suiscan.xyz/testnet/tx/${txDigest}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-gray-400 hover:text-white transition-colors"
                  >
                    View on Suiscan ↗
                  </a>
                )}
                <a href="/portfolio" className="text-[11px] text-gray-400 hover:text-white transition-colors">
                  Portfolio →
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <PrivateTicketLedger
          tickets={privateTickets}
          balanceDusdc={privateBalance}
          busy={step !== 'idle'}
          onCashOut={handlePrivateCashout}
          onWithdraw={handlePrivateWithdraw}
        />

        {/* Trading account is auto-provisioned silently on market open (see the
            auto-provision effect) — no visible "create account" step. */}

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
          quantity={positionQty}
          fairPrice={fairPrice}
          feeBreakdown={feeBreakdown}
          estimatedTradeCost={estTradeCost || null}
          leverage={leverage}
          frontedAmount={frontedMicro}
          premiumAmount={premiumMicro}
          privacyMode={privacyMode}
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

function PrivateTicketLedger({
  tickets,
  balanceDusdc,
  busy,
  onCashOut,
  onWithdraw,
}: {
  tickets: PrivateBetTicket[];
  balanceDusdc: number;
  busy: boolean;
  onCashOut: (ticket: PrivateBetTicket) => void;
  onWithdraw: (mode: PrivateWithdrawMode) => void;
}) {
  if (tickets.length === 0) return null;

  return (
    <div className="rounded-xl bg-new-mint/[0.035] border border-new-mint/15 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
          Private balance
        </span>
        <span className="text-[10px] font-mono text-new-mint">{balanceDusdc.toFixed(2)} DUSDC</span>
      </div>
      <div className="rounded-lg border border-white/5 bg-black/25 p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-mono font-bold text-white">{balanceDusdc.toFixed(2)} DUSDC</p>
            <p className="text-[11px] leading-relaxed text-gray-500 mt-1">
              Private cashouts land here first, so the public Predict position does not instantly point back to your wallet.
            </p>
          </div>
          <ShieldCheck className="w-4 h-4 text-new-mint shrink-0 mt-1" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onWithdraw('fast')}
            disabled={busy || balanceDusdc <= 0}
            className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-200 transition-colors hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wallet className="w-3.5 h-3.5" />
            Fast withdraw
          </button>
          <button
            type="button"
            onClick={() => onWithdraw('private')}
            disabled={busy || balanceDusdc <= 0}
            className="flex items-center justify-center gap-2 rounded-lg border border-new-mint/20 bg-new-mint/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-new-mint transition-colors hover:border-new-mint/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Private withdraw
          </button>
        </div>
        <p className="text-[10px] leading-relaxed text-gray-600">
          Fast withdraw pays your connected wallet now. Private withdraw uses the separated beta route; full zk unlinking needs the Vortex pool upgrade.
        </p>
      </div>
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600">
          Private tickets
        </span>
        <span className="text-[10px] font-mono text-gray-500">{tickets.length}</span>
      </div>
      {tickets.slice(0, 3).map((ticket) => {
        const credited = ticket.status === 'credited';
        const withdrawn = ticket.status === 'withdrawn' || ticket.status === 'cashed_out';
        const open = ticket.status === 'open';
        return (
          <div key={ticket.digest} className="rounded-lg border border-white/5 bg-black/20 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className={`font-mono text-xs font-bold ${ticket.side === 'UP' ? 'text-new-mint' : 'text-rose-400'}`}>
                {ticket.side} · {formatStrike(ticket.strike)}
              </span>
              <span className={`font-mono text-[9px] ${open ? 'text-vermilion' : credited ? 'text-new-mint' : 'text-gray-500'}`}>
                {open ? 'OPEN' : credited ? 'IN BALANCE' : 'WITHDRAWN'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-gray-500">
              <span>{(ticket.stakeMicro / DUSDC_MULTIPLIER).toFixed(2)} DUSDC</span>
              <span className="text-right">
                {credited || withdrawn ? `${(ticket.payoutDusdc ?? 0).toFixed(2)} credited` : `${(ticket.quantity / DUSDC_MULTIPLIER).toFixed(2)} payout units`}
              </span>
              <span className="truncate">session {ticket.sessionAddress ? `${ticket.sessionAddress.slice(0, 6)}...${ticket.sessionAddress.slice(-4)}` : 'pending'}</span>
              <a
                href={`https://suiscan.xyz/testnet/tx/${ticket.digest}`}
                target="_blank"
                rel="noreferrer"
                className="text-right text-gray-400 hover:text-white"
              >
                tx {ticket.digest.slice(0, 6)}...{ticket.digest.slice(-4)}
              </a>
            </div>
            <button
              type="button"
              onClick={() => onCashOut(ticket)}
              disabled={busy || !open}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-new-mint/20 bg-new-mint/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-new-mint transition-colors hover:border-new-mint/40 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <LogOut className="w-3.5 h-3.5" />
              {open ? 'Cash out to balance' : credited ? 'In Private Balance' : 'Withdrawn'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

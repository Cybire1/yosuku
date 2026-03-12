'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader, Lock, Radar, Shield, Wallet } from 'lucide-react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { fetchOnChainBalance, PRED_MULTIPLIER, setOptimisticBalance } from '@/lib/predictionContract';
import { executeWithRetry } from '@/lib/walletExecution';
import {
  MIRROR_PROGRAM,
  createMirrorPositionId,
  getOpenMirrorPosition,
  saveMirrorPosition,
  type MirrorMarketData,
} from '@/lib/mirrorMarkets';

const QUICK_AMOUNTS = [25, 50, 100, 250];

function formatPred(microAmount: number) {
  return (microAmount / PRED_MULTIPLIER).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

interface MirrorTradePanelProps {
  market: MirrorMarketData | null;
  onSuccess?: () => void;
  roomId?: string;
  roomLocked?: boolean;
}

export default function MirrorTradePanel({ market, onSuccess, roomId, roomLocked = false }: MirrorTradePanelProps) {
  const { address, executeTransaction } = useWallet();
  const [side, setSide] = useState<'YES' | 'NO'>('YES');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [balance, setBalance] = useState(0);
  const [hasOpenPosition, setHasOpenPosition] = useState(false);

  useEffect(() => {
    if (!address) {
      setBalance(0);
      return;
    }
    fetchOnChainBalance(address).then(setBalance).catch(() => {});
    const interval = window.setInterval(() => {
      fetchOnChainBalance(address).then(setBalance).catch(() => {});
    }, 5000);
    return () => window.clearInterval(interval);
  }, [address]);

  useEffect(() => {
    setAmount('');
    setError('');
    setSide('YES');
    setHasOpenPosition(market ? Boolean(getOpenMirrorPosition(market.marketId)) : false);
  }, [market]);

  const microAmount = Math.floor(parseFloat(amount || '0') * PRED_MULTIPLIER);
  const canTrade = Boolean(market?.onChainCreated && !market?.onChainResolved && market?.vaultAddress);

  const payout = useMemo(() => {
    if (!market || microAmount <= 0) return 0;
    const multiplier = side === 'YES' ? market.yesMultiplierBps : market.noMultiplierBps;
    return Math.floor((microAmount * multiplier) / 10000);
  }, [market, microAmount, side]);

  const handleQuickAmount = (value: number) => {
    const current = parseFloat(amount || '0');
    setAmount((current + value).toString());
  };

  const handleBet = async () => {
    if (!market) return;
    if (roomLocked) {
      setError('Unlock this private room before trading');
      return;
    }
    if (!address || !executeTransaction) {
      setError('Connect wallet first');
      return;
    }
    if (!canTrade) {
      setError('This mirrored market is not live on Aleo yet');
      return;
    }
    if (hasOpenPosition) {
      setError('You already have an open mirrored position on this market');
      return;
    }
    if (!microAmount || microAmount <= 0) {
      setError('Enter an amount');
      return;
    }
    if (microAmount > balance) {
      setError('Insufficient USDCx');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await executeWithRetry(() =>
        executeTransaction({
          program: MIRROR_PROGRAM,
          function: 'bet',
          inputs: [
            market.vaultAddress!,
            `${market.marketId}u64`,
            `${microAmount}u128`,
            `${market.yesMultiplierBps}u64`,
            `${market.noMultiplierBps}u64`,
            side === 'YES' ? 'true' : 'false',
          ],
          fee: 2_000_000,
          privateFee: false,
        })
      );

      const newBalance = Math.max(0, balance - microAmount);
      setOptimisticBalance(newBalance);
      setBalance(newBalance);
      saveMirrorPosition({
        positionId: createMirrorPositionId(market.marketId),
        marketId: market.marketId,
        sourceMarketId: market.sourceMarketId,
        question: market.question,
        description: market.description,
        slug: market.slug,
        category: market.category,
        roomId,
        side,
        amount: microAmount,
        payout,
        timestamp: Date.now(),
        claimed: false,
        forfeited: false,
        refunded: false,
        outcomeLabels: market.outcomeLabels,
        ...(result?.transactionId ? { transactionId: result.transactionId } : {}),
      });
      setHasOpenPosition(true);
      setAmount('');
      onSuccess?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Mirror bet failed';
      if (message.toLowerCase().includes('rejected')) {
        setError('Transaction rejected');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!market) {
    return null;
  }

  const yesPct = Math.round(market.publicYesPrice * 100);
  const noPct = Math.round(market.publicNoPrice * 100);

  return (
    <section className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_360px]">
      <div className="rounded-3xl border border-white/7 bg-neutral-950/70 p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-new-mint/20 bg-new-mint/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-new-mint">
            v13 hidden-side execution
          </span>
          <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] ${
            market.onChainCreated
              ? 'border-off-blue/20 bg-off-blue/10 text-off-blue'
              : 'border-white/8 bg-white/[0.03] text-gray-400'
          }`}>
            {market.onChainCreated ? 'Live on Aleo' : 'Queued for Aleo'}
          </span>
          {market.onChainResolved && (
            <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
              Resolved
            </span>
          )}
        </div>

        <h3 className="text-2xl font-black leading-tight text-white">{market.question}</h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">
          {market.description || 'This market was mirrored from Polymarket and can now be traded privately on Aleo through dart_mirror_v13.'}
        </p>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/6 bg-black/35 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Public consensus</p>
            <div className="mt-2 flex items-center justify-between text-sm font-bold">
              <span className="text-new-mint">{market.outcomeLabels[0]} {yesPct}%</span>
              <span className="text-off-red">{market.outcomeLabels[1]} {noPct}%</span>
            </div>
          </div>
          <div className="rounded-2xl border border-white/6 bg-black/35 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Aleo fixed odds</p>
            <div className="mt-2 flex items-center justify-between text-sm font-bold">
              <span className="text-new-mint">{(market.yesMultiplierBps / 10000).toFixed(2)}x</span>
              <span className="text-off-red">{(market.noMultiplierBps / 10000).toFixed(2)}x</span>
            </div>
          </div>
          <div className="rounded-2xl border border-white/6 bg-black/35 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Mirror market id</p>
            <p className="mt-2 font-mono text-sm font-bold text-white">{market.marketId}</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/6 bg-black/35 p-4 text-sm text-gray-400">
          <div className="flex flex-wrap items-center gap-2">
            <Radar className="h-4 w-4 text-off-blue" />
            <span className="font-semibold text-white">Mirror source:</span>
            <a
              href={`https://polymarket.com/event/${market.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-off-blue hover:text-white transition-colors"
            >
              polymarket.com/event/{market.slug}
            </a>
          </div>
          <p className="mt-3">
            Once the market is created on Aleo, bets route through the `dart_mirror_v13.aleo` contract with hidden-side receipts, worst-case reserve accounting, and fixed payouts locked privately at entry time.
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-white/7 bg-neutral-950/70 p-5 sm:p-6 xl:sticky xl:top-28 h-fit">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-4 w-4 text-new-mint" />
          <h4 className="text-sm font-bold uppercase tracking-[0.22em] text-white">Trade privately</h4>
        </div>

        {(roomLocked || !canTrade) && (
          <div className="mb-4 rounded-2xl border border-white/6 bg-white/[0.03] p-3 text-sm text-gray-400">
            {roomLocked
              ? 'This mirrored market belongs to a private room. Unlock the room to place a trade.'
              : market.onChainResolved
              ? 'This mirrored market has already resolved on Aleo.'
              : 'This market is in the mirror queue, but it is not live on Aleo yet. Enable on-chain mirroring and deploy v13 to make it tradable.'}
          </div>
        )}
        {hasOpenPosition && (
          <div className="mb-4 rounded-2xl border border-new-mint/15 bg-new-mint/10 p-3 text-sm text-new-mint">
            You already have an open v13 position on this mirrored market. Claim, refund, or forfeit it from your portfolio after settlement.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSide('YES')}
            className={`rounded-2xl border px-4 py-3 text-left transition-all ${
              side === 'YES'
                ? 'border-new-mint/30 bg-new-mint/10 text-white'
                : 'border-white/8 bg-white/[0.03] text-gray-400 hover:text-white'
            }`}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.24em]">{market.outcomeLabels[0]}</p>
            <p className="mt-1 text-lg font-black">{(market.yesMultiplierBps / 10000).toFixed(2)}x</p>
          </button>
          <button
            onClick={() => setSide('NO')}
            className={`rounded-2xl border px-4 py-3 text-left transition-all ${
              side === 'NO'
                ? 'border-off-red/30 bg-off-red/10 text-white'
                : 'border-white/8 bg-white/[0.03] text-gray-400 hover:text-white'
            }`}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.24em]">{market.outcomeLabels[1]}</p>
            <p className="mt-1 text-lg font-black">{(market.noMultiplierBps / 10000).toFixed(2)}x</p>
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-white/6 bg-black/35 p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <span>Balance</span>
            <span className="font-bold text-white">{formatPred(balance)} USDCx</span>
          </div>

          <input
            type="number"
            inputMode="decimal"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-base font-semibold text-white outline-none transition-colors placeholder:text-gray-600 focus:border-new-mint/30"
          />

          <div className="mt-3 grid grid-cols-4 gap-2">
            {QUICK_AMOUNTS.map((value) => (
              <button
                key={value}
                onClick={() => handleQuickAmount(value)}
                className="rounded-xl border border-white/8 bg-white/[0.03] px-2 py-2 text-xs font-bold text-gray-300 transition-colors hover:border-new-mint/20 hover:text-new-mint"
              >
                +{value}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/6 bg-black/35 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-gray-400">Locked payout</span>
            <span className="font-bold text-white">{formatPred(payout)} USDCx</span>
          </div>
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-gray-400">Program</span>
            <span className="font-mono text-xs text-gray-300">{MIRROR_PROGRAM}</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-new-mint/15 bg-new-mint/10 px-3 py-2 text-xs text-new-mint">
            <Lock className="h-3.5 w-3.5" />
            Side stays hidden during active betting. Your payout is locked in the encrypted receipt, and winning claims settle to a shielded USDCx record.
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-off-red/20 bg-off-red/10 px-4 py-3 text-sm text-off-red">
            {error}
          </div>
        )}

        <motion.button
          whileTap={{ scale: 0.98 }}
          disabled={loading || !canTrade || roomLocked || hasOpenPosition}
          onClick={handleBet}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black uppercase tracking-[0.2em] text-black transition-all disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Loader className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
          {loading ? 'Submitting...' : `Trade ${side === 'YES' ? market.outcomeLabels[0] : market.outcomeLabels[1]}`}
        </motion.button>
      </div>
    </section>
  );
}

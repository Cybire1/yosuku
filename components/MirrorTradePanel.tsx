'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock3, Loader, Lock, Shield, TrendingUp, Wallet } from 'lucide-react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { fetchOnChainBalance } from '@/lib/predictionContract';
import { formatPred, getMirrorPayout, submitMirrorBet } from '@/lib/mirrorTrade';
import {
  getOpenMirrorPosition,
  type MirrorSide,
  type MirrorMarketData,
} from '@/lib/mirrorMarkets';

const QUICK_AMOUNTS = [25, 50, 100, 250];

interface MirrorTradePanelProps {
  market: MirrorMarketData | null;
  onSuccess?: () => void;
  roomId?: string;
  roomLocked?: boolean;
  className?: string;
  compact?: boolean;
  preferredSide?: MirrorSide | null;
}

function formatVolume(volume: number) {
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}

function formatEndDate(endDate?: string) {
  if (!endDate) return 'No close time';
  const date = new Date(endDate);
  if (Number.isNaN(date.getTime())) return 'Invalid close time';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function MirrorTradePanel({
  market,
  onSuccess,
  roomId,
  roomLocked = false,
  className = '',
  compact = false,
  preferredSide = null,
}: MirrorTradePanelProps) {
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
    setSide(preferredSide ?? 'YES');
    setHasOpenPosition(market ? Boolean(getOpenMirrorPosition(market.marketId)) : false);
  }, [market, preferredSide]);

  const microAmount = Math.floor(parseFloat(amount || '0') * 1_000_000);
  const canTrade = Boolean(market?.onChainCreated && !market?.onChainResolved && market?.vaultAddress);

  const payout = useMemo(() => {
    return getMirrorPayout(market, side, microAmount);
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
      setError('This market is not live yet');
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
      await submitMirrorBet({
        executeTransaction,
        market,
        side,
        microAmount,
        balance,
        roomId,
        onBalance: setBalance,
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
    return (
      <section className={`${className} rounded-3xl border border-white/7 bg-neutral-950/70 p-5 sm:p-6`}>
        <div className={`flex flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-white/10 bg-black/25 px-6 text-center ${compact ? 'min-h-[300px]' : 'min-h-[420px]'}`}>
          <div className="mb-4 rounded-full border border-white/8 bg-white/[0.03] p-3">
            <TrendingUp className="h-5 w-5 text-gray-400" />
          </div>
          <h3 className="text-lg font-bold text-white">Select a market</h3>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-400">
            Pick a market card to load the ticket and trade from here.
          </p>
        </div>
      </section>
    );
  }

  const yesPct = Math.round(market.publicYesPrice * 100);
  const noPct = Math.round(market.publicNoPrice * 100);
  return (
    <section className={`${className} rounded-3xl border border-white/7 bg-neutral-950/70 p-5 sm:p-6`}>
      <h3 className={`${compact ? 'text-xl' : 'text-2xl'} font-black leading-tight text-white`}>{market.question}</h3>
      {!compact && (
        <p className="mt-2 text-sm leading-relaxed text-gray-400">
          {market.description || 'This market is ready for hidden-side execution with fixed odds and shielded settlement.'}
        </p>
      )}

      <div className={`mt-5 grid gap-3 ${compact ? '' : 'sm:grid-cols-2'}`}>
        <div className="rounded-[1.5rem] border border-white/6 bg-black/35 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Signal</p>
          <div className="mt-2 flex items-center justify-between text-base font-bold">
            <span className="text-new-mint">{market.outcomeLabels[0]} {yesPct}%</span>
            <span className="text-off-red">{market.outcomeLabels[1]} {noPct}%</span>
          </div>
        </div>
        <div className="rounded-[1.5rem] border border-white/6 bg-black/35 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Market stats</p>
          <div className="mt-2 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Volume</span>
              <span className="font-semibold text-white">{formatVolume(market.volume24hr || market.volume)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-gray-400">
                <Clock3 className="h-3.5 w-3.5" />
                Close
              </span>
              <span className="font-semibold text-white">{formatEndDate(market.endDate)}</span>
            </div>
          </div>
        </div>
      </div>

      {!compact && (
        <div className="mt-5 rounded-[1.5rem] border border-white/6 bg-black/35 p-4 text-sm text-gray-400">
          <p className="font-semibold text-white">Execution</p>
          <p className="mt-2">
            Bets settle through hidden-side receipts with fixed payouts locked at entry. Winning claims resolve to shielded USDCx records.
          </p>
        </div>
      )}

      {(roomLocked || !canTrade) && (
        <div className="mt-5 rounded-2xl border border-white/6 bg-white/[0.03] p-3 text-sm text-gray-400">
          {roomLocked
            ? 'This market belongs to a private room. Unlock the room to place a trade.'
            : market.onChainResolved
            ? 'This market has already resolved.'
            : 'This market is queued and not live yet. It can still be followed from the feed.'}
        </div>
      )}

      {hasOpenPosition && (
        <div className="mt-5 rounded-2xl border border-new-mint/15 bg-new-mint/10 p-3 text-sm text-new-mint">
          You already have an open v13 position on this market. Claim, refund, or forfeit it from your portfolio after settlement.
        </div>
      )}

      <div className="mt-5 rounded-[1.75rem] border border-white/6 bg-black/35 p-4">
        <div className="mb-4 flex items-center gap-2">
          <span className="rounded-full border border-new-mint/20 bg-new-mint/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-new-mint">
            Hidden-side execution
          </span>
          <Shield className="h-4 w-4 text-new-mint" />
          <h4 className="text-sm font-bold uppercase tracking-[0.22em] text-white">Place trade</h4>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSide('YES')}
            className={`rounded-2xl border px-4 py-3 text-left transition-all ${
              side === 'YES'
                ? 'border-[#86efac]/35 bg-[#bbf7d8] text-[#07281d]'
                : 'border-[#86efac]/20 bg-[#86efac]/10 text-[#b7f7d0] hover:bg-[#86efac]/16'
            }`}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.24em]">{market.outcomeLabels[0]}</p>
            <p className="mt-1 text-lg font-black">{(market.yesMultiplierBps / 10000).toFixed(2)}x</p>
          </button>
          <button
            onClick={() => setSide('NO')}
            className={`rounded-2xl border px-4 py-3 text-left transition-all ${
              side === 'NO'
                ? 'border-[#fda4af]/35 bg-[#fecdd3] text-[#4a101c]'
                : 'border-[#fda4af]/20 bg-[#fda4af]/10 text-[#fecdd3] hover:bg-[#fda4af]/16'
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
            <span className="text-gray-400">Market ID</span>
            <span className="font-mono text-xs text-gray-300">{market.marketId}</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-new-mint/15 bg-new-mint/10 px-3 py-2 text-xs text-new-mint">
            <Lock className="h-3.5 w-3.5" />
            Side stays hidden while the market is open.
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

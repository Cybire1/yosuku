'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Clock3, Loader, Wallet } from 'lucide-react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { fetchOnChainBalance } from '@/lib/predictionContract';
import { formatPred, getMirrorPayout, submitMirrorBet } from '@/lib/mirrorTrade';
import { getOpenMirrorPosition, type MirrorMarketData } from '@/lib/mirrorMarkets';
import type { MirrorSide } from '@/lib/mirrorMarkets';

interface MirrorMarketCardProps {
  market: MirrorMarketData;
  selected?: boolean;
  activeSide?: MirrorSide | null;
  onSelect?: (market: MirrorMarketData) => void;
  onChooseSide?: (market: MirrorMarketData, side: MirrorSide) => void;
  roomLocked?: boolean;
  roomId?: string;
  onTradeSuccess?: () => void;
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
  });
}

export default function MirrorMarketCard({
  market,
  selected = false,
  activeSide = null,
  onSelect,
  onChooseSide,
  roomLocked = false,
  roomId,
  onTradeSuccess,
}: MirrorMarketCardProps) {
  const { address, executeTransaction } = useWallet();
  const yesPct = Math.round(market.publicYesPrice * 100);
  const noPct = Math.round(market.publicNoPrice * 100);
  const yesLabel = market.outcomeLabels[0] || 'Yes';
  const noLabel = market.outcomeLabels[1] || 'No';
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasOpenPosition, setHasOpenPosition] = useState(false);

  useEffect(() => {
    if (!address) {
      setBalance(0);
      return;
    }

    fetchOnChainBalance(address).then(setBalance).catch(() => {});
  }, [address, market.marketId]);

  useEffect(() => {
    setHasOpenPosition(Boolean(getOpenMirrorPosition(market.marketId)));
  }, [market.marketId]);

  useEffect(() => {
    if (!selected) {
      setAmount('');
      setError('');
    }
  }, [selected]);

  const chosenSide = activeSide ?? 'YES';
  const expanded = selected && Boolean(activeSide);
  const microAmount = Math.floor(parseFloat(amount || '0') * 1_000_000);
  const payout = useMemo(() => getMirrorPayout(market, chosenSide, microAmount), [market, chosenSide, microAmount]);
  const canTrade = Boolean(market.onChainCreated && !market.onChainResolved && market.vaultAddress);

  const handleChooseSide = (side: MirrorSide) => {
    setError('');
    onChooseSide?.(market, side);
  };

  const handleSubmit = async () => {
    if (roomLocked) {
      setError('Unlock room to trade');
      return;
    }
    if (!address || !executeTransaction) {
      setError('Connect wallet first');
      return;
    }
    if (!canTrade) {
      setError('Market not live');
      return;
    }
    if (hasOpenPosition) {
      setError('Open position exists');
      return;
    }
    if (!microAmount || microAmount <= 0) {
      setError('Enter amount');
      return;
    }
    if (microAmount > balance) {
      setError('Insufficient balance');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await submitMirrorBet({
        executeTransaction,
        market,
        side: chosenSide,
        microAmount,
        balance,
        roomId,
        onBalance: setBalance,
      });
      setHasOpenPosition(true);
      setAmount('');
      onTradeSuccess?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Trade failed';
      setError(message.toLowerCase().includes('rejected') ? 'Transaction rejected' : message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <article
      className={`rounded-[1.35rem] border p-4 transition-all ${
        selected
          ? 'border-new-mint/25 bg-new-mint/[0.07] shadow-[0_0_0_1px_rgba(52,211,153,0.08)]'
          : 'border-white/7 bg-black/35 hover:border-white/14'
      }`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-300">
          {market.category}
        </span>
        <span
          className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] ${
            market.onChainCreated
              ? 'border-new-mint/20 bg-new-mint/10 text-new-mint'
              : 'border-white/8 bg-white/[0.03] text-gray-400'
          }`}
        >
          {market.onChainCreated ? 'Live' : 'Queued'}
        </span>
      </div>

      <button onClick={() => onSelect?.(market)} className="block w-full text-left">
        <h3 className="line-clamp-2 text-base font-bold leading-tight text-white">
          {market.question}
        </h3>
      </button>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-new-mint">{yesLabel}</p>
          <div className="mt-2 flex items-end justify-between gap-2">
            <p className="text-xl font-black text-white">{yesPct}%</p>
            <p className="text-base font-bold text-white">{(market.yesMultiplierBps / 10000).toFixed(2)}x</p>
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-off-red">{noLabel}</p>
          <div className="mt-2 flex items-end justify-between gap-2">
            <p className="text-xl font-black text-white">{noPct}%</p>
            <p className="text-base font-bold text-white">{(market.noMultiplierBps / 10000).toFixed(2)}x</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
        <span className="font-semibold text-gray-300">{formatVolume(market.volume24hr || market.volume)} vol</span>
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3.5 w-3.5" />
          {formatEndDate(market.endDate)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2">
        <button
          onClick={() => handleChooseSide('YES')}
          className={`rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors ${
            expanded && chosenSide === 'YES'
              ? 'bg-new-mint text-black'
              : 'bg-new-mint/12 text-new-mint hover:bg-new-mint/18'
          }`}
        >
          {yesLabel}
        </button>
        <button
          onClick={() => handleChooseSide('NO')}
          className={`rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors ${
            expanded && chosenSide === 'NO'
              ? 'bg-off-red text-black'
              : 'bg-off-red/12 text-off-red hover:bg-off-red/18'
          }`}
        >
          {noLabel}
        </button>

        <Link
          href={`/markets/${market.marketId}`}
          className="inline-flex items-center justify-end gap-1 rounded-full px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 transition-colors hover:text-white"
        >
          Details
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {expanded && (
        <div className="mt-4 rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <span>Amount</span>
            <span className="font-semibold text-white">{formatPred(balance)} USDCx</span>
          </div>

          <input
            type="number"
            inputMode="decimal"
            placeholder="Enter amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="w-full rounded-xl border border-white/8 bg-black/35 px-3 py-3 text-sm font-semibold text-white outline-none placeholder:text-gray-600 focus:border-new-mint/30"
          />

          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-gray-500">Locked payout</span>
            <span className="font-bold text-white">{formatPred(payout)} USDCx</span>
          </div>

          {error && (
            <div className="mt-3 rounded-xl border border-off-red/20 bg-off-red/10 px-3 py-2 text-xs text-off-red">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !canTrade || roomLocked || hasOpenPosition}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? <Loader className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            {loading ? 'Submitting...' : `Trade ${chosenSide === 'YES' ? yesLabel : noLabel}`}
          </button>
        </div>
      )}
    </article>
  );
}

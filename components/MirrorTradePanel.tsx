// @ts-nocheck
'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader, Lock, Radar, Shield, Wallet } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { PRED_MULTIPLIER } from '@/lib/predictionContract';
import {
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
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [side, setSide] = useState<'YES' | 'NO'>('YES');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [balance, setBalance] = useState(0);
  const [hasOpenPosition, setHasOpenPosition] = useState(false);

  useEffect(() => {
    // Balance tracking moved to useDUSDCBalance hook
    // Mirror trades use localStorage-based tracking only now
    setBalance(0);
  }, [address]);

  useEffect(() => {
    setAmount('');
    setError('');
    setSide('YES');
    setHasOpenPosition(market ? Boolean(getOpenMirrorPosition(market.marketId)) : false);
  }, [market]);

  const microAmount = Math.floor(parseFloat(amount || '0') * PRED_MULTIPLIER);
  const canTrade = false;

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
    if (!address) {
      setError('Connect wallet first');
      return;
    }
    if (!canTrade) {
      setError('This mirrored market is not live yet');
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

    setLoading(true);
    setError('');

    try {
      // Mirror trades are saved locally — Sui on-chain integration TBD
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
      });
      setHasOpenPosition(true);
      setAmount('');
      onSuccess?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Mirror bet failed';
      setError(message);
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
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-300">
            Mirror Preview
          </span>
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-amber-300">
            Local-only
          </span>
          {market.onChainResolved && (
            <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
              Resolved
            </span>
          )}
        </div>

        <h3 className="text-2xl font-black leading-tight text-white">{market.question}</h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">
          {market.description || 'This market was mirrored from Polymarket for preview and room-gating experiments.'}
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
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Fixed odds</p>
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
            Mirrored markets replicate public market data from Polymarket for discovery, pricing experiments, and private-room previews. This cut does not settle mirror positions on Sui yet.
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-white/7 bg-neutral-950/70 p-5 sm:p-6 xl:sticky xl:top-28 h-fit">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-4 w-4 text-new-mint" />
          <h4 className="text-sm font-bold uppercase tracking-[0.22em] text-white">Place trade</h4>
        </div>

        {(roomLocked || !canTrade) && (
          <div className="mb-4 rounded-2xl border border-white/6 bg-white/[0.03] p-3 text-sm text-gray-400">
            {roomLocked
              ? 'This mirrored market belongs to a private room. Unlock the room to place a trade.'
              : market.onChainResolved
              ? 'This mirrored source market has already resolved.'
              : 'Mirror trading is preview-only in this build. Use BTC Predict markets for end-to-end Sui settlement.'}
          </div>
        )}
        {hasOpenPosition && (
          <div className="mb-4 rounded-2xl border border-new-mint/15 bg-new-mint/10 p-3 text-sm text-new-mint">
            You already have a local preview position on this mirrored market. It can be marked from the mirror portfolio after the source market resolves.
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
            <span className="font-bold text-white">{formatPred(balance)} DUSDC</span>
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
            <span className="font-bold text-white">{formatPred(payout)} DUSDC</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-new-mint/15 bg-new-mint/10 px-3 py-2 text-xs text-new-mint">
            <Lock className="h-3.5 w-3.5" />
            Preview position only. No DUSDC leaves your wallet and no Sui settlement is performed.
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
          {loading ? 'Submitting...' : 'Preview only'}
        </motion.button>
      </div>
    </section>
  );
}

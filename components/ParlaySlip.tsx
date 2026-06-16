'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Clock, Trophy, Loader2, Layers } from 'lucide-react';
import { useMyParlays } from '@/lib/sui/parlayHooks';
import { claimParlayTx, type MyParlay, type ParlayLegState } from '@/lib/sui/parlayClient';
import { FLOAT_SCALING } from '@/lib/sui/constants';
import { humanizeTxError } from '@/lib/errorMessages';
import { useToast } from './Toast';

const fmtUsd = (strike: bigint) => {
  const v = Number(strike) / FLOAT_SCALING;
  return v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${v.toFixed(0)}`;
};

function useNow(tickMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return now;
}

function countdown(expiryMs: number, now: number): string {
  const s = Math.max(0, Math.round((expiryMs - now) / 1000));
  if (s === 0) return 'ringing…';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

function LegRow({ leg, idx, now }: { leg: ParlayLegState; idx: number; now: number }) {
  const won = leg.status === 'won';
  const lost = leg.status === 'lost';
  const pending = leg.status === 'pending';
  return (
    <div className="flex items-center gap-3 py-2 border-t border-white/[0.05] first:border-t-0">
      <span className="font-mono text-[10px] text-gray-600 w-4 shrink-0">{String(idx + 1).padStart(2, '0')}</span>
      <span
        className={`w-5 h-5 rounded-full grid place-items-center shrink-0 ${
          won ? 'bg-vermilion text-white' : lost ? 'bg-white/10 text-gray-500' : 'border border-white/15 text-gray-500'
        }`}
      >
        {won ? <Check size={12} strokeWidth={3} /> : lost ? <X size={12} strokeWidth={3} /> : <Clock size={11} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-display text-[13px] text-white leading-tight">
          BTC <span className={leg.isUp ? 'text-vermilion' : 'text-sky-400'}>{leg.isUp ? 'UP' : 'DOWN'}</span>
          <span className="text-gray-500"> · {fmtUsd(leg.strike)}</span>
        </div>
      </div>
      <span className="font-mono text-[11px] tabular-nums shrink-0">
        {won && <span className="text-vermilion">won</span>}
        {lost && <span className="text-gray-500">missed</span>}
        {pending && <span className="text-gray-400">{countdown(Number(leg.expiry), now)}</span>}
      </span>
    </div>
  );
}

function ParlayCard({ p, now, onClaimed }: { p: MyParlay; now: number; onClaimed: () => void }) {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { toast } = useToast();
  const [claiming, setClaiming] = useState(false);

  const multiplier = p.stake > 0 ? p.maxPayout / p.stake : 0;
  const lost = p.status === 'lost';
  const won = p.status === 'won';

  const claim = useCallback(async () => {
    setClaiming(true);
    try {
      const res = await signAndExecute({ transaction: claimParlayTx({ parlay: p.id }) });
      toast(`Claimed ${p.maxPayout.toFixed(2)} DUSDC · ${res.digest.slice(0, 8)}…`, 'success');
      onClaimed();
    } catch (err) {
      const friendly = humanizeTxError(err);
      toast(friendly.title, 'error');
    } finally {
      setClaiming(false);
    }
  }, [signAndExecute, p.id, p.maxPayout, toast, onClaimed]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border p-5 transition-colors ${
        won ? 'border-vermilion/40 bg-vermilion/[0.04]'
          : lost ? 'border-white/[0.06] bg-neutral-900/30 opacity-60'
          : 'border-white/[0.08] bg-neutral-900/40'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-vermilion" />
          <span className="font-display font-bold text-sm text-white">{p.legs.length}-leg streak</span>
          <StatusPill status={p.status} wonCount={p.wonCount} total={p.legs.length} />
        </div>
        <div className="text-right">
          <div className="font-display font-[800] text-lg text-vermilion leading-none tabular-nums">{multiplier.toFixed(1)}×</div>
          <div className="font-mono text-[10px] text-gray-500 mt-0.5">{p.stake.toFixed(2)} → {p.maxPayout.toFixed(2)}</div>
        </div>
      </div>

      <div className="mb-1">
        {p.legs.map((leg, i) => <LegRow key={i} leg={leg} idx={i} now={now} />)}
      </div>

      {won && (
        <button
          onClick={claim}
          disabled={claiming}
          className="w-full mt-3 flex items-center justify-center gap-2 bg-vermilion hover:bg-vermilion-d disabled:opacity-60 text-white font-display font-bold text-sm py-2.5 rounded-xl transition-colors"
        >
          {claiming ? <Loader2 size={15} className="animate-spin" /> : <Trophy size={15} />}
          {claiming ? 'Claiming…' : `Claim ${p.maxPayout.toFixed(2)} DUSDC`}
        </button>
      )}
      {lost && (
        <p className="mt-3 text-[12px] text-gray-500 text-center">
          One leg settled against you — the ticket is dead, stake lost.
        </p>
      )}
    </motion.div>
  );
}

function StatusPill({ status, wonCount, total }: { status: string; wonCount: number; total: number }) {
  if (status === 'won')
    return <span className="font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-full bg-vermilion/15 text-vermilion">Won</span>;
  if (status === 'lost')
    return <span className="font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-full bg-white/5 text-gray-500">Dead</span>;
  return (
    <span className="font-mono text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-full bg-white/5 text-gray-300">
      In play · {wonCount}/{total}
    </span>
  );
}

export default function ParlaySlip() {
  const { parlays, refresh, loading, address } = useMyParlays();
  const now = useNow();

  if (!address || (parlays.length === 0 && !loading)) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.08] bg-neutral-900/20 p-8 text-center">
        <p className="font-mono text-[11px] tracking-wider uppercase text-gray-600">
          {address ? 'No open tickets yet — build a streak above' : 'Connect to see your tickets'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AnimatePresence mode="popLayout">
        {parlays.map((p) => (
          <ParlayCard key={p.id} p={p} now={now} onClaimed={refresh} />
        ))}
      </AnimatePresence>
    </div>
  );
}

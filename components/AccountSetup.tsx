'use client';

import { useState, useEffect } from 'react';
import { Loader2, Check, Sparkles, AlertCircle } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { createManagerTx } from '@/lib/sui/predictClient';
import { getSponsorStatus, type SponsorStatus } from '@/lib/sponsor';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { humanizeTxError } from '@/lib/errorMessages';
import { useToast } from './Toast';

interface AccountSetupProps {
  onReady?: () => void;
}

/**
 * Proactive one-time trading-account setup, shown when the connected wallet
 * has no PredictManager yet. If an Onara gas station is configured the
 * creation is sponsored (gas-free); otherwise the user pays gas. Either way,
 * doing this ahead of time makes the first real trade a single tap.
 */
export default function AccountSetup({ onReady }: AccountSetupProps) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();
  const { toast } = useToast();

  const [sponsor, setSponsor] = useState<SponsorStatus | null>(null);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getSponsorStatus().then((s) => { if (!cancelled) setSponsor(s); });
    return () => { cancelled = true; };
  }, []);

  const setUp = async () => {
    if (!address) return;
    setError('');
    setPhase('working');
    try {
      await submit(() => createManagerTx());
      setPhase('done');
      toast('Trading account ready — trades are now one tap.', 'success');
      onReady?.();
    } catch (err: unknown) {
      console.error('Account setup error:', err);
      setPhase('idle');
      setError(humanizeTxError(err).title);
    }
  };

  if (phase === 'done') {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <p className="text-[11px] text-gray-400">Trading account ready. Every trade is now a single confirmation.</p>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-2.5">
      <div className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-gray-400 leading-relaxed">
          <span className="text-white font-semibold">Set up your trading account once, trade in one tap forever.</span>{' '}
          {sponsor
            ? 'Gas is on us — free, takes a few seconds.'
            : 'Takes a few seconds and a little SUI gas.'}{' '}
          Skip it, and it simply happens during your first trade instead.
        </p>
      </div>
      {error && (
        <div className="flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-px" />
          <p className="text-[11px] text-rose-400 break-words">{error}</p>
        </div>
      )}
      <button
        onClick={setUp}
        disabled={phase === 'working'}
        className="w-full py-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 hover:border-white/20 text-white text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {phase === 'working' ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Setting up...
          </>
        ) : sponsor ? (
          'Set up account — free'
        ) : (
          'Set up account now'
        )}
      </button>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { Check, X, ArrowRight } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useDUSDCBalance } from '@/lib/sui/hooks';
import { loadPositions } from '@/lib/roundHelpers';

const DISMISS_KEY = 'yosuku_firstrun_dismissed';

/**
 * The cold-start funnel. A slim, non-blocking floating bar that shows a
 * first-time visitor the exact path to their first bet — sign in, get test
 * funds, take a side — and ticks each step off as they actually do it. The
 * next actionable step is highlighted so attention always has somewhere to go.
 * Auto-hides once they place a trade (or on explicit dismiss).
 */
export default function FirstRunGuide() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { balance } = useDUSDCBalance();
  const [dismissed, setDismissed] = useState(true); // hidden until storage is read (no hydration flash)
  const [hasTraded, setHasTraded] = useState(false);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === '1'); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const check = () => setHasTraded(loadPositions().length > 0);
    check();
    const iv = setInterval(check, 4000);
    return () => clearInterval(iv);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  };

  if (dismissed || hasTraded) return null;

  const steps = [
    { label: 'Sign in', hint: 'Google or a Sui wallet', done: !!address },
    { label: 'Get test funds', hint: 'free DUSDC, no real money', done: balance > 0, tappable: true,
      action: () => window.dispatchEvent(new CustomEvent('yosuku:open-funds')) },
    { label: 'Take a side', hint: 'tap UP or DOWN on a market', done: false },
  ];
  const nextIdx = steps.findIndex(s => !s.done);

  return (
    <div className="fixed z-[60] left-1/2 -translate-x-1/2 bottom-[88px] md:bottom-6 w-[calc(100%-1.5rem)] max-w-2xl">
      <div className="relative rounded-2xl border border-white/10 bg-[#0c0c0f]/95 backdrop-blur-md shadow-[0_8px_40px_rgba(0,0,0,0.5)] px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-gray-500">
            New here <span className="text-vermilion/70">·</span> three steps to your first bet
          </span>
          <button onClick={dismiss} aria-label="Dismiss" className="text-gray-600 hover:text-white transition-colors -mr-1 p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          {steps.map((s, i) => {
            const isNext = i === nextIdx;
            return (
              <button
                key={s.label}
                onClick={s.action}
                disabled={!s.tappable}
                className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                  s.tappable && !s.done ? 'hover:bg-white/[0.05] cursor-pointer' : 'cursor-default'
                } ${isNext ? 'bg-white/[0.035] ring-1 ring-vermilion/25' : ''}`}
              >
                <span
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-mono shrink-0 transition-colors ${
                    s.done
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : isNext
                        ? 'bg-vermilion text-white'
                        : 'bg-white/[0.06] text-gray-500'
                  }`}
                >
                  {s.done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[12.5px] font-semibold leading-tight ${s.done ? 'text-gray-500 line-through decoration-gray-700' : 'text-white'}`}>
                    {s.label}
                  </span>
                  <span className="block text-[10.5px] text-gray-500 leading-tight truncate">{s.hint}</span>
                </span>
                {isNext && s.tappable && <ArrowRight className="w-3.5 h-3.5 text-vermilion shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

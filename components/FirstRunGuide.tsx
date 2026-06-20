'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
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
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(true); // hidden until storage is read (no hydration flash)
  const [hasTraded, setHasTraded] = useState(false);
  const [modeChosen, setModeChosen] = useState(true); // hidden until storage read — first-timers pick Simple/Pro first

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
      setModeChosen(localStorage.getItem('yosuku_mode_chosen') === '1');
    } catch { /* ignore */ }
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

  // First-timer's first decision: pick the experience level so the whole trade UI
  // matches them from the start. TradePanel reads yosuku_trade_mode on mount.
  const chooseMode = (m: 'simple' | 'pro') => {
    try {
      localStorage.setItem('yosuku_trade_mode', m);
      localStorage.setItem('yosuku_mode_chosen', '1');
    } catch { /* ignore */ }
    setModeChosen(true);
  };

  if (dismissed || hasTraded) return null;

  // Step 0 of onboarding — pick your level. Shown only AFTER the wallet is connected:
  // before that, the welcome Tutorial (which ends on the Connect step) is the first-run
  // surface, so we never stack a second modal on a not-yet-connected visitor. This is the
  // fallback for anyone who skipped the Tutorial without choosing. It's a prominent,
  // centered modal (not a slim bar a first-timer slides past), and it appears even on a
  // trade surface because the choice changes the trade panel itself. Closing it "skips"
  // to the friendly default and lets the rest of the funnel continue.
  if (!modeChosen && address) {
    const skip = () => chooseMode('simple');
    return (
      <div
        className="fixed inset-0 z-[130] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="firstrun-title"
      >
        <motion.div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={skip}
        />
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', damping: 24, stiffness: 320 }}
          className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0c0c0f] shadow-[0_24px_80px_rgba(0,0,0,0.7)] px-6 pt-6 pb-5"
        >
          <button
            type="button"
            onClick={skip}
            aria-label="Skip"
            className="absolute top-4 right-4 rounded-full p-1 text-gray-600 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-vermilion" style={{ boxShadow: '0 0 12px var(--vermilion)' }} />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-gray-500">
              Welcome to Yosuku · one quick thing
            </span>
          </div>

          <h2 id="firstrun-title" className="font-display text-[22px] font-extrabold tracking-tight text-white leading-tight mb-1.5">
            How familiar are you with prediction markets?
          </h2>
          <p className="text-gray-400 text-[13px] leading-relaxed mb-5">
            This just sets how much detail you see — you can switch anytime with the Simple / Pro toggle.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button onClick={() => chooseMode('simple')} className="group rounded-xl border border-white/10 bg-white/[0.03] hover:border-vermilion/50 hover:bg-vermilion/[0.06] px-4 py-3.5 text-left transition-all">
              <span className="block text-[15px] font-bold text-white">New to this</span>
              <span className="block text-[12px] text-gray-400 leading-snug mt-1">Plain questions — just Higher or Lower</span>
              <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-mono text-vermilion opacity-0 group-hover:opacity-100 transition-opacity">
                Start simple <ArrowRight className="w-3 h-3" />
              </span>
            </button>
            <button onClick={() => chooseMode('pro')} className="group rounded-xl border border-white/10 bg-white/[0.03] hover:border-vermilion/50 hover:bg-vermilion/[0.06] px-4 py-3.5 text-left transition-all">
              <span className="block text-[15px] font-bold text-white">I trade</span>
              <span className="block text-[12px] text-gray-400 leading-snug mt-1">Strikes, leverage, the full panel</span>
              <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-mono text-vermilion opacity-0 group-hover:opacity-100 transition-opacity">
                Go pro <ArrowRight className="w-3 h-3" />
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={skip}
            className="block w-full text-center mt-4 text-[11px] font-mono text-gray-600 hover:text-gray-400 transition-colors"
          >
            Skip — I&apos;ll decide later
          </button>
        </motion.div>
      </div>
    );
  }

  // Don't crowd the trade surfaces — on a market detail page or the bell, the
  // user is already taking a side, so the "tap UP or DOWN" guide is just noise.
  const onTradeSurface = pathname === '/bell' || /^\/markets\/[^/]+/.test(pathname ?? '');
  if (onTradeSurface) return null;

  const steps = [
    { label: 'Sign in', hint: 'Google or a Sui wallet', done: !!address },
    { label: 'Get wallet funds', hint: 'free DUSDC, no real money', done: balance > 0, tappable: true,
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

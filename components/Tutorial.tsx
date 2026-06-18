'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

const STORAGE_KEY = 'yosuku_tutorial_seen';

interface TutorialStep {
  title: string;
  jp: string;
  description: string;
  actions?: { label: string; href: string }[];
  choice?: boolean; // final step: pick Simple/Pro trade view
}

// A brief welcome that sets the mental model. The actual to-do list — sign in,
// get funds, take a side — lives in the persistent FirstRunGuide bar, so this
// modal stays short instead of re-walking steps the bar already tracks.
const steps: TutorialStep[] = [
  {
    title: 'Welcome to Yosuku',
    jp: 'ようこそ',
    description: 'A prediction market on BTC. Pick a side, the oracle settles at the bell, the math decides. This is testnet — test funds only, no real money.',
  },
  {
    title: 'How a round works',
    jp: '方向を選ぶ',
    description: 'Every market asks one question: will BTC be above your line at the bell? Go UP for above, DOWN for below. Get it right and you are paid automatically. Gas is on us, and there is no seed phrase.',
  },
  {
    title: 'Setup is automatic',
    jp: '準備完了',
    description: 'No seed phrase, no setup screen, no gas. We create and fund your on-chain account in the background — the three steps in the corner tick off as you go. Then it is one tap to bet.',
  },
  {
    title: 'Pick your view',
    jp: 'はじめる',
    description: 'Switch anytime with the Simple / Pro toggle in the trade panel.',
    choice: true,
  },
];

export default function Tutorial() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch { /* ignore */ }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
  };

  // The final onboarding decision: set the trade view to match the user's level so
  // the whole panel opens right for them. TradePanel reads yosuku_trade_mode on mount;
  // yosuku_mode_chosen tells the FirstRunGuide fallback the choice is already made.
  const chooseMode = (m: 'simple' | 'pro') => {
    try {
      localStorage.setItem('yosuku_trade_mode', m);
      localStorage.setItem('yosuku_mode_chosen', '1');
    } catch { /* ignore */ }
    dismiss();
  };

  // Never trap the user: Escape closes, and so does clicking the backdrop.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const isLast = step === steps.length - 1;
  const current = steps[step];

  return (
    <div
      className="fixed inset-0 z-[9500] flex items-end justify-center p-4 sm:items-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-xl bg-neutral-900/95 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl"
        >
          <div className="px-8 pt-8 pb-3 flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-gray-600 mb-1.5">
                {current.jp}
              </div>
              <h3 className="font-display font-bold text-2xl text-white">{current.title}</h3>
            </div>
            <button onClick={dismiss} className="p-1 text-gray-600 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-8 py-5">
            {current.choice ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <button onClick={() => chooseMode('simple')} className="rounded-xl border border-white/[0.12] bg-white/[0.03] hover:border-vermilion/50 hover:bg-white/[0.06] px-4 py-4 text-left transition-colors">
                    <span className="block font-display font-bold text-white text-lg">New to this</span>
                    <span className="block text-xs text-gray-500 mt-1 leading-snug">Plain questions — just tap Higher or Lower. We handle the rest.</span>
                  </button>
                  <button onClick={() => chooseMode('pro')} className="rounded-xl border border-white/[0.12] bg-white/[0.03] hover:border-vermilion/50 hover:bg-white/[0.06] px-4 py-4 text-left transition-colors">
                    <span className="block font-display font-bold text-white text-lg">I trade</span>
                    <span className="block text-xs text-gray-500 mt-1 leading-snug">Strikes, leverage, range markets — the full panel.</span>
                  </button>
                </div>
                <p className="text-xs text-gray-600">{current.description}</p>
              </>
            ) : (
              <p className="text-base text-gray-400 leading-relaxed">{current.description}</p>
            )}
            {current.actions && (
              <div className="flex flex-wrap gap-2 mt-4">
                {current.actions.map((a) => (
                  <a
                    key={a.href}
                    href={a.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-lg border border-white/15 text-white hover:bg-white/[0.06] hover:border-white/30 transition-colors"
                  >
                    {a.label} ↗
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="px-8 pb-8 flex items-center justify-between">
            {/* Step indicators */}
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all ${
                    i === step ? 'w-6 bg-vermilion' : i < step ? 'w-2 bg-white/20' : 'w-2 bg-white/10'
                  }`}
                />
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={dismiss}
                className="px-5 py-2.5 text-sm font-medium text-gray-500 hover:text-white transition-colors"
              >
                Skip
              </button>
              {!current.choice && (
                <button
                  onClick={() => isLast ? dismiss() : setStep(step + 1)}
                  className="px-6 py-2.5 bg-vermilion text-white text-sm font-bold uppercase tracking-wider rounded-lg hover:bg-vermilion/90 transition-colors"
                >
                  {isLast ? 'Get Started' : 'Next'}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X } from 'lucide-react';

/**
 * The "you're funded" moment. When a first-time visitor connects, the app silently
 * drips test DUSDC into their wallet — which used to happen with no fanfare at all
 * (a tiny mono pill that was easy to miss). This is the visible beat that says it
 * happened: a one-time celebratory card, fired from the Header's auto-fund path via a
 * `yosuku:credited` event with `firstTime: true`. Routine top-ups use a quiet toast.
 */
export default function CreditWelcome() {
  const [credit, setCredit] = useState<{ amount: number } | null>(null);

  useEffect(() => {
    const onCredited = (e: Event) => {
      const detail = (e as CustomEvent).detail as { amount?: number; firstTime?: boolean } | undefined;
      if (!detail?.firstTime) return; // only celebrate the first credit
      setCredit({ amount: detail.amount ?? 2 });
    };
    window.addEventListener('yosuku:credited', onCredited as EventListener);
    return () => window.removeEventListener('yosuku:credited', onCredited as EventListener);
  }, []);

  // Auto-dismiss — it's a moment, not a wall. The user can also close or tap the CTA.
  useEffect(() => {
    if (!credit) return;
    const t = setTimeout(() => setCredit(null), 8000);
    return () => clearTimeout(t);
  }, [credit]);

  return (
    <AnimatePresence>
      {credit && (
        <motion.div
          className="fixed inset-0 z-[140] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setCredit(null)}
          />
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ type: 'spring', damping: 20, stiffness: 280 }}
            className="relative w-full max-w-sm rounded-2xl border border-emerald-500/25 bg-[#0c0c0f] px-6 pt-7 pb-6 text-center shadow-[0_24px_90px_rgba(16,185,129,0.18)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credit-title"
          >
            <button
              type="button"
              onClick={() => setCredit(null)}
              aria-label="Close"
              className="absolute top-3.5 right-3.5 rounded-full p-1 text-gray-600 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', damping: 12, stiffness: 240, delay: 0.05 }}
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10"
              style={{ boxShadow: '0 0 28px rgba(16,185,129,0.25)' }}
            >
              <Sparkles className="h-6 w-6 text-emerald-400" />
            </motion.div>

            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400/80">
              You&apos;re funded
            </span>
            <h2 id="credit-title" className="font-display text-2xl font-extrabold tracking-tight text-white mt-1.5">
              {credit.amount} test USDC is in your wallet
            </h2>
            <p className="text-gray-400 text-[13px] leading-relaxed mt-2 mb-5">
              On the house — these are testnet play chips, not real money. You&apos;re ready to take your first side.
            </p>

            <button
              type="button"
              onClick={() => setCredit(null)}
              className="w-full bg-vermilion text-white font-semibold rounded-full py-3 hover:bg-vermilion-d transition-colors"
            >
              Let&apos;s go →
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';

const WORDS = ['PREDICT', 'PRIVATE', 'PROFIT'];

export default function Preloader() {
  const [loading, setLoading] = useState(false);

  // Only show preloader on first visit (not on navigation)
  useEffect(() => {
    if (!sessionStorage.getItem('preloaderShown')) {
      setLoading(true);
    }
  }, []);
  const [wordIndex, setWordIndex] = useState(0);
  const progress = useMotionValue(0);
  const displayCount = useTransform(progress, (v) => Math.round(v));
  const [count, setCount] = useState(0);
  const barWidth = useTransform(progress, [0, 100], ['0%', '100%']);
  const columnRef = useRef<HTMLDivElement>(null);

  // Animate the progress counter with easing (fast start, slow middle, fast end)
  useEffect(() => {
    if (!loading) return;

    const unsubscribe = displayCount.on('change', (v) => setCount(v));

    const controls = animate(progress, 100, {
      duration: 2.4,
      ease: [0.25, 0.1, 0.25, 1],
      onComplete: () => {
        setTimeout(() => {
          sessionStorage.setItem('preloaderShown', '1');
          setLoading(false);
        }, 600);
      },
    });

    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [loading, progress, displayCount]);

  // Cycle through words
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setWordIndex((i) => (i + 1) % WORDS.length);
    }, 800);
    return () => clearInterval(interval);
  }, [loading]);

  return (
    <AnimatePresence mode="wait">
      {loading && (
        <motion.div
          className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center overflow-hidden"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.76, 0, 0.24, 1], delay: 0.3 }}
        >
          {/* Horizontal scan line */}
          <motion.div
            className="absolute left-0 w-full h-px bg-gradient-to-r from-transparent via-new-mint to-transparent opacity-40"
            initial={{ top: '0%' }}
            animate={{ top: '100%' }}
            transition={{ duration: 2.4, ease: 'linear', repeat: Infinity }}
          />

          {/* Center content */}
          <div className="relative flex flex-col items-center gap-10">
            {/* Word rotator */}
            <div className="h-8 overflow-hidden relative" ref={columnRef}>
              <AnimatePresence mode="wait">
                <motion.span
                  key={wordIndex}
                  className="block text-sm tracking-[0.4em] text-white/50 font-mono uppercase"
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -20, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.76, 0, 0.24, 1] }}
                >
                  {WORDS[wordIndex]}
                </motion.span>
              </AnimatePresence>
            </div>

            {/* Counter — large cinematic number */}
            <motion.div
              className="relative"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="text-[8rem] md:text-[11rem] font-black tracking-tighter text-white tabular-nums leading-none select-none">
                {String(count).padStart(3, '0')}
              </span>
              {/* Subtle glow behind number */}
              <div className="absolute inset-0 blur-3xl bg-new-mint/5 rounded-full -z-10" />
            </motion.div>

            {/* Progress bar */}
            <div className="w-64 md:w-80 relative">
              <div className="h-px w-full bg-white/10" />
              <motion.div
                className="absolute top-0 left-0 h-px bg-new-mint"
                style={{ width: barWidth }}
              />
              {/* Glow dot at bar tip */}
              <motion.div
                className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-new-mint shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                style={{ left: barWidth }}
              />
            </div>

            {/* Brand */}
            <motion.p
              className="text-[10px] tracking-[0.3em] text-white/20 uppercase font-mono"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              DART PROTOCOL
            </motion.p>
          </div>

          {/* Corner accents */}
          <div className="absolute top-6 left-6 w-5 h-5 border-t border-l border-white/10" />
          <div className="absolute top-6 right-6 w-5 h-5 border-t border-r border-white/10" />
          <div className="absolute bottom-6 left-6 w-5 h-5 border-b border-l border-white/10" />
          <div className="absolute bottom-6 right-6 w-5 h-5 border-b border-r border-white/10" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

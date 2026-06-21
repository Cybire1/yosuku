'use client';

import { useState } from 'react';
import { VenetianMask, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface IncognitoToggleProps {
  mode: 'public' | 'private';
  onChange: (mode: 'public' | 'private') => void;
}

/**
 * Incognito mode switch — trade without revealing your wallet. Public is the default, so
 * this is one toggle (not a two-option pill) with a tappable (i) that explains what
 * turning it on gets you — tap works on touch, where a hover-only tooltip wouldn't.
 */
export default function IncognitoToggle({ mode, onChange }: IncognitoToggleProps) {
  const isPrivate = mode === 'private';
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className={`rounded-xl border px-3 py-2.5 transition-colors ${isPrivate ? 'border-off-blue/40 bg-off-blue/[0.08]' : 'border-white/10 bg-black/30'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <VenetianMask className={`w-4 h-4 shrink-0 transition-colors ${isPrivate ? 'text-off-blue' : 'text-gray-500'}`} />
          <span className="text-[13px] font-semibold text-white whitespace-nowrap">Trade privately</span>
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            aria-label="What is incognito mode?"
            aria-expanded={showInfo}
            className={`shrink-0 transition-colors ${showInfo ? 'text-gray-300' : 'text-gray-600 hover:text-gray-300'}`}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* the single switch — off = public (default), on = incognito */}
        <button
          type="button"
          role="switch"
          aria-checked={isPrivate}
          aria-label="Trade privately"
          onClick={() => onChange(isPrivate ? 'public' : 'private')}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${isPrivate ? 'bg-off-blue/40 border-off-blue/60' : 'bg-white/[0.08] border-white/15'}`}
        >
          <motion.span
            initial={false}
            animate={{ x: isPrivate ? 22 : 2 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            className="absolute top-1 left-0 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
          />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showInfo && (
          <motion.p
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 10 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden text-[11px] leading-relaxed text-gray-500"
          >
            <span className="text-gray-300">On:</span> trade without revealing your wallet — entry and cash-out route through Vortex, a temporary on-device wallet that never links to your main one. <span className="text-gray-300">Off:</span> a normal public trade.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

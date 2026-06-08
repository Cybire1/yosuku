'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

const STORAGE_KEY = 'yosuku_tutorial_seen';

const steps = [
  {
    title: 'Welcome to Yosuku',
    jp: 'ようこそ',
    description: 'Yosuku is a prediction market on Sui. Trade binary positions on BTC price direction with 15-minute settlement windows.',
  },
  {
    title: 'Pick a Market',
    jp: '市場を選ぶ',
    description: 'Each market has a strike price and expiry. Choose one from the list — markets closing soon are at the top.',
  },
  {
    title: 'Choose Your Direction',
    jp: '方向を選ぶ',
    description: 'Go UP if you think BTC will be above the strike at expiry. Go DOWN if you think it will be below.',
  },
  {
    title: 'Set Your Amount',
    jp: '金額を設定',
    description: 'Enter how much DUSDC you want to trade. You\'ll see the fair price, fees, and potential payout before confirming.',
  },
  {
    title: 'You\'re Ready',
    jp: '準備完了',
    description: 'That\'s it. Connect your wallet, fund with DUSDC, and start trading. Good luck on the floor.',
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

  if (!visible) return null;

  const isLast = step === steps.length - 1;
  const current = steps[step];

  return (
    <div className="fixed inset-0 z-[9500] flex items-end justify-center p-4 sm:items-center bg-black/70 backdrop-blur-sm">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-md bg-neutral-900/95 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl"
        >
          <div className="px-6 pt-6 pb-2 flex items-start justify-between">
            <div>
              <div className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 mb-1">
                {current.jp}
              </div>
              <h3 className="font-display font-bold text-lg text-white">{current.title}</h3>
            </div>
            <button onClick={dismiss} className="p-1 text-gray-600 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-6 py-4">
            <p className="text-sm text-gray-400 leading-relaxed">{current.description}</p>
          </div>

          <div className="px-6 pb-6 flex items-center justify-between">
            {/* Step indicators */}
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all ${
                    i === step ? 'w-5 bg-vermilion' : i < step ? 'w-2 bg-white/20' : 'w-2 bg-white/10'
                  }`}
                />
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={dismiss}
                className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-white transition-colors"
              >
                Skip
              </button>
              <button
                onClick={() => isLast ? dismiss() : setStep(step + 1)}
                className="px-5 py-2 bg-vermilion text-white text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-vermilion/90 transition-colors"
              >
                {isLast ? 'Get Started' : 'Next'}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

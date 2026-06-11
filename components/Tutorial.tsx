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
}

const steps: TutorialStep[] = [
  {
    title: 'Welcome to Yosuku',
    jp: 'ようこそ',
    description: 'Yosuku is a prediction market on Sui testnet. Trade binary positions on BTC price direction with 15-minute settlement windows. Test funds only — no real money.',
  },
  {
    title: 'Connect a Wallet',
    jp: 'ウォレット接続',
    description: 'Use the Connect button in the header with any Sui wallet. This is testnet, so the wallet you connect never risks real funds.',
  },
  {
    title: 'Get Test Funds',
    jp: '資金を入手',
    description: 'You need two things: SUI for gas (free, instant from the faucet) and DUSDC to trade with (issued via a quick request form).',
    actions: [
      { label: 'SUI gas faucet', href: 'https://faucet.sui.io/' },
      { label: 'Request DUSDC', href: 'https://tally.so/r/Xx102L' },
    ],
  },
  {
    title: 'Pick a Market and a Side',
    jp: '方向を選ぶ',
    description: 'Each market asks one question — will the price be above the strike at expiry? Go UP for above, DOWN for below. Markets closing soon are at the top.',
  },
  {
    title: 'Set Your Amount',
    jp: '金額を設定',
    description: 'Enter how much DUSDC to trade. The exact cost is read live from the contract — you see fair price, fees, and max payout before you sign anything.',
  },
  {
    title: 'Your First Trade Sets You Up',
    jp: '準備完了',
    description: 'The first trade also creates your on-chain trading account — one extra wallet confirmation, a few seconds, one time only. After that it\'s one tap per trade. Good luck on the floor.',
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
            <p className="text-base text-gray-400 leading-relaxed">{current.description}</p>
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
              <button
                onClick={() => isLast ? dismiss() : setStep(step + 1)}
                className="px-6 py-2.5 bg-vermilion text-white text-sm font-bold uppercase tracking-wider rounded-lg hover:bg-vermilion/90 transition-colors"
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

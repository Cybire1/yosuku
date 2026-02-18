'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, Target, Zap, TrendingUp, Clock, Coins, Trophy, HelpCircle, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';

export default function HowItWorksPage() {
  const router = useRouter();

  const steps = [
    {
      number: 1,
      title: 'Connect & Mint',
      description: 'Connect your Leo Wallet and mint free DART tokens from the faucet. No purchase needed — it\'s a demo token for testnet.',
      icon: Coins,
      numClass: 'bg-new-mint/10 text-new-mint',
      iconClass: 'text-new-mint',
    },
    {
      number: 2,
      title: 'Pick a Round',
      description: 'Each round has a BTC target price and a countdown timer. Will BTC be above or below the target when time runs out?',
      icon: Target,
      numClass: 'bg-new-blue/10 text-new-blue',
      iconClass: 'text-new-blue',
    },
    {
      number: 3,
      title: 'Bet YES or NO',
      description: 'Bet YES if you think BTC will be at or above the target price. Bet NO if you think it\'ll be below. Choose your amount in DART.',
      icon: Zap,
      numClass: 'bg-new-mint/10 text-new-mint',
      iconClass: 'text-new-mint',
    },
    {
      number: 4,
      title: 'Collect Winnings',
      description: 'When the round resolves, winners split the total pool proportionally. A 10% platform fee is deducted from winnings.',
      icon: Trophy,
      numClass: 'bg-new-blue/10 text-new-blue',
      iconClass: 'text-new-blue',
    },
  ];

  const mechanics = [
    {
      title: 'Parimutuel Pools',
      description: 'All bets go into a shared pool. Winners split the entire pool based on their share of the winning side. The more you bet relative to others, the bigger your payout.',
      icon: Coins,
    },
    {
      title: 'Live BTC Price',
      description: 'Real-time BTC/USDT price streamed from Binance. The chart shows price movement with the target line so you can track your position.',
      icon: TrendingUp,
    },
    {
      title: 'Multiple Durations',
      description: 'Rounds can be 1 minute, 5 minutes, 15 minutes, 30 minutes, or 1 hour. Pick the timeframe that matches your conviction.',
      icon: Clock,
    },
    {
      title: 'On-Chain Settlement',
      description: 'Everything runs on Aleo smart contracts. Bets, pools, and payouts are all verifiable on-chain. No middleman.',
      icon: Zap,
    },
  ];

  const faqs = [
    {
      question: 'What are DART tokens?',
      answer: 'DART is a free demo token on Aleo testnet. Anyone can mint from the faucet. It\'s used to place bets in prediction rounds — no real money involved.',
    },
    {
      question: 'How is the winner decided?',
      answer: 'At round end, the admin resolves with the actual BTC price. If BTC >= target price, YES wins. If BTC < target, NO wins. It\'s that simple.',
    },
    {
      question: 'How much do I win?',
      answer: 'Your payout = (your bet / winning pool) × total pool × 90%. The 10% fee goes to the platform. For example, if you bet 100 DART on YES, the YES pool is 500, and total pool is 1000 — you\'d get (100/500) × 1000 × 0.9 = 180 DART.',
    },
    {
      question: 'What wallet do I need?',
      answer: 'You need Leo Wallet, the browser extension for Aleo. It\'s free and works on Chrome and Firefox.',
    },
    {
      question: 'Is this real money?',
      answer: 'No. DART tokens are free testnet tokens with no real value. This is a demo running on Aleo testnet for educational and testing purposes.',
    },
    {
      question: 'Can I create my own rounds?',
      answer: 'Currently only the admin can create rounds. In the future, anyone will be able to create prediction markets on any topic.',
    },
  ];

  return (
    <div className="min-h-screen text-white overflow-x-hidden selection:bg-white selection:text-black">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-new-mint/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-new-blue/5 blur-[120px] rounded-full" />
      </div>

      <Header />

      <main className="pt-28 pb-20 relative z-10">
        <div className="max-w-[1000px] mx-auto px-6">
          {/* Back */}
          <button
            onClick={() => router.push('/markets')}
            className="flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-10 text-xs font-bold uppercase tracking-widest group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
            Back to Markets
          </button>

          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-16"
          >
            <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white mb-4">
              How It Works
            </h1>
            <p className="text-lg text-gray-400 max-w-2xl leading-relaxed">
              Predict BTC price movements. Bet with DART tokens. Win from the pool.
            </p>
          </motion.div>

          {/* Steps */}
          <div className="mb-20">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-8">Getting Started</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {steps.map((step, index) => (
                <motion.div
                  key={step.number}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.08 }}
                  className="bg-neutral-900/50 border border-white/5 hover:border-white/10 rounded-2xl p-6 transition-all group"
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl ${step.numClass} flex items-center justify-center flex-shrink-0`}>
                      <span className="font-black text-sm">{step.number}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-bold text-white mb-1.5 flex items-center gap-2">
                        <step.icon className={`w-4 h-4 ${step.iconClass}`} />
                        {step.title}
                      </h3>
                      <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Payout Example */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-20 bg-neutral-900/50 border border-new-mint/10 rounded-2xl p-8"
          >
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-6">Payout Example</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="text-center">
                <div className="text-3xl font-black font-mono text-new-mint">500</div>
                <div className="text-xs text-gray-500 mt-1">YES Pool (DART)</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-black font-mono text-off-red">500</div>
                <div className="text-xs text-gray-500 mt-1">NO Pool (DART)</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-black font-mono text-white">1,000</div>
                <div className="text-xs text-gray-500 mt-1">Total Pool (DART)</div>
              </div>
            </div>
            <div className="border-t border-white/5 pt-6">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-400">You bet</span>
                <span className="px-3 py-1 bg-new-mint/10 text-new-mint font-mono font-bold text-sm rounded-lg">100 DART on YES</span>
                <ArrowRight className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-400">YES wins</span>
                <ArrowRight className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-400">You get</span>
                <span className="px-3 py-1 bg-new-mint/10 text-new-mint font-mono font-bold text-sm rounded-lg">180 DART</span>
                <span className="text-xs text-gray-600">(100/500 × 1000 × 90%)</span>
              </div>
            </div>
          </motion.div>

          {/* Mechanics */}
          <div className="mb-20">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-8">Key Mechanics</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mechanics.map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + index * 0.08 }}
                  className="bg-neutral-900/50 border border-white/5 hover:border-white/10 rounded-2xl p-6 transition-all"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                      <item.icon className="w-4 h-4 text-gray-400" />
                    </div>
                    <h3 className="text-base font-bold text-white">{item.title}</h3>
                  </div>
                  <p className="text-sm text-gray-400 leading-relaxed">{item.description}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* FAQ */}
          <div className="mb-20">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-8 flex items-center gap-2">
              <HelpCircle className="w-4 h-4" />
              FAQ
            </h2>
            <div className="space-y-3">
              {faqs.map((faq, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + index * 0.05 }}
                  className="bg-neutral-900/50 border border-white/5 rounded-xl p-5"
                >
                  <h3 className="text-sm font-bold text-white mb-2">{faq.question}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{faq.answer}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="text-center bg-neutral-900/50 border border-new-mint/10 rounded-2xl p-12"
          >
            <h2 className="text-2xl font-black mb-3">Ready to Predict?</h2>
            <p className="text-gray-400 text-sm mb-6 max-w-md mx-auto">
              Mint free DART tokens, pick a side, and see if you can beat the market.
            </p>
            <button
              onClick={() => router.push('/markets')}
              className="px-8 py-3 bg-new-mint text-black font-bold uppercase tracking-widest text-xs rounded-xl hover:bg-new-mint/90 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_30px_rgba(52,211,153,0.2)]"
            >
              Go to Markets
            </button>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

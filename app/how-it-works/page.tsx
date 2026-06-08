'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Target, Zap, TrendingUp, Clock, Coins, Trophy, HelpCircle, ArrowRight, Shield, EyeOff, Lock, ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';

export default function HowItWorksPage() {
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const steps = [
    {
      number: 1,
      title: 'Connect & Fund',
      description: 'Connect your Sui wallet and fund it with DUSDC. DUSDC is the stablecoin used on DeepBook Predict.',
      icon: Coins,
      numClass: 'bg-new-mint/10 text-new-mint',
      iconClass: 'text-new-mint',
    },
    {
      number: 2,
      title: 'Pick a Market',
      description: 'Each market has a BTC strike price and a fifteen-minute window. Will BTC be above or below the strike when the window closes?',
      icon: Target,
      numClass: 'bg-new-blue/10 text-new-blue',
      iconClass: 'text-new-blue',
    },
    {
      number: 3,
      title: 'Trade UP or DOWN',
      description: 'Go UP if you think BTC will be at or above the strike price. Go DOWN if you think it\'ll be below. Choose your position size in DUSDC.',
      icon: Zap,
      numClass: 'bg-new-mint/10 text-new-mint',
      iconClass: 'text-new-mint',
    },
    {
      number: 4,
      title: 'Collect Payout',
      description: 'When the market settles, the oracle reports the final price. Winning positions pay out automatically. A 1-2% settlement fee applies.',
      icon: Trophy,
      numClass: 'bg-new-blue/10 text-new-blue',
      iconClass: 'text-new-blue',
    },
  ];

  const mechanics = [
    {
      title: 'SVI Pricing Model',
      description: 'Positions are priced using a Stochastic Volatility Inspired (SVI) model. A vault provides liquidity, so there are no counterparties — you trade directly against the protocol.',
      icon: Coins,
    },
    {
      title: 'Live BTC Price',
      description: 'Real-time BTC price from Pyth Network oracle feeds on Sui. The chart shows price movement relative to the strike so you can track your position.',
      icon: TrendingUp,
    },
    {
      title: 'Fifteen-Minute Windows',
      description: 'Markets run in fifteen-minute windows — short enough to be engaging, long enough for genuine price discovery. Continuous rounds, always open.',
      icon: Clock,
    },
    {
      title: 'On-Chain Settlement',
      description: 'Everything runs on Sui smart contracts via DeepBook Predict. Positions and payouts are all verifiable on-chain with sub-second finality. No middleman, full transparency.',
      icon: Shield,
    },
  ];

  const faqs = [
    {
      question: 'What currency does YOSUKU use?',
      answer: 'YOSUKU uses DUSDC — a stablecoin on Sui used by DeepBook Predict. On testnet, you can get DUSDC from the faucet.',
    },
    {
      question: 'How is the outcome decided?',
      answer: 'When the window closes, the Pyth oracle reports the final BTC price. If BTC >= strike price, UP positions win. If BTC < strike, DOWN positions win. Settlement is automatic and deterministic.',
    },
    {
      question: 'How much do I win?',
      answer: 'Each position pays out $1 per unit if correct, $0 if not. Your cost is the SVI fair price (e.g. 64¢ for a 64% probability UP position). If you win, your profit is $1 minus cost per unit. A 1-2% settlement fee applies.',
    },
    {
      question: 'What wallet do I need?',
      answer: 'You need a Sui-compatible wallet such as Sui Wallet, Suiet, or Martian. They are free browser extensions.',
    },
    {
      question: 'Is this real money?',
      answer: 'On testnet, DUSDC is available from the faucet. This is a demo running on Sui testnet for educational and testing purposes.',
    },
    {
      question: 'How does YOSUKU ensure fair pricing?',
      answer: 'Positions are priced by an SVI (Stochastic Volatility Inspired) model — the same family of models used in traditional options markets. A vault provides liquidity, so there are no counterparties to manipulate prices. All positions and payouts are settled on-chain by DeepBook Predict smart contracts.',
    },
    {
      question: 'Can I sell a position before settlement?',
      answer: 'Yes. Active positions can be sold back to the vault at the current fair price before the window closes. The sell price reflects the latest market conditions.',
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
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white mb-4">
              How It Works
            </h1>
            <p className="text-lg text-gray-400 max-w-2xl leading-relaxed">
              Predict BTC price movements. Trade UP or DOWN with DUSDC. Settle on-chain.
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
            className="mb-20 bg-neutral-900/50 border border-new-mint/10 rounded-2xl p-4 sm:p-6 md:p-8"
          >
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-6">Payout Example</h2>
            <div className="grid grid-cols-3 gap-3 sm:gap-6 mb-6">
              <div className="text-center">
                <div className="text-xl sm:text-2xl md:text-3xl font-black font-mono text-new-mint">64%</div>
                <div className="text-xs text-gray-500 mt-1">UP fair price</div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl md:text-3xl font-black font-mono text-off-red">36%</div>
                <div className="text-xs text-gray-500 mt-1">DOWN fair price</div>
              </div>
              <div className="text-center">
                <div className="text-xl sm:text-2xl md:text-3xl font-black font-mono text-white">$1.00</div>
                <div className="text-xs text-gray-500 mt-1">Max payout / unit</div>
              </div>
            </div>
            <div className="border-t border-white/5 pt-6">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-400">You buy</span>
                <span className="px-3 py-1 bg-new-mint/10 text-new-mint font-mono font-bold text-sm rounded-lg">100 UP @ 64¢ each</span>
                <ArrowRight className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-400">BTC above strike</span>
                <ArrowRight className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-400">You get</span>
                <span className="px-3 py-1 bg-new-mint/10 text-new-mint font-mono font-bold text-sm rounded-lg">100 DUSDC</span>
                <span className="text-xs text-gray-600">(+36 DUSDC profit)</span>
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

          {/* SVI Pricing Model */}
          <div className="mb-20">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-8">SVI Pricing Model</h2>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="bg-neutral-900/50 border border-white/5 rounded-2xl p-6 md:p-8"
            >
              <p className="text-sm text-gray-400 leading-relaxed mb-6">
                Positions are priced using the <span className="text-white font-medium">Stochastic Volatility Inspired (SVI)</span> parameterization,
                the same family of models used in traditional options markets. The implied variance surface is defined as:
              </p>
              <div className="bg-black/40 border border-white/5 rounded-xl p-4 mb-6 font-mono text-sm text-vermilion overflow-x-auto">
                w(k) = a + b * ( ρ * (k - m) + √((k - m)² + σ²) )
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-gray-400">
                <div><span className="text-white font-mono">a</span> — overall variance level</div>
                <div><span className="text-white font-mono">b</span> — slope of the wings</div>
                <div><span className="text-white font-mono">ρ</span> — skew / rotation</div>
                <div><span className="text-white font-mono">m</span> — horizontal shift (at-the-money)</div>
                <div><span className="text-white font-mono">σ</span> — smoothing (curvature at ATM)</div>
                <div><span className="text-white font-mono">k</span> — log-moneyness ln(K/F)</div>
              </div>
              <p className="text-sm text-gray-500 mt-6 leading-relaxed">
                The SVI parameters are calibrated on-chain and updated continuously.
                Fair price is derived from the implied volatility, which determines the probability of settlement above/below the strike.
              </p>
            </motion.div>
          </div>

          {/* Fee Structure */}
          <div className="mb-20">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-8">Fee Structure</h2>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-neutral-900/50 border border-white/5 rounded-2xl p-6 md:p-8 space-y-6"
            >
              <div>
                <h3 className="text-sm font-bold text-white mb-2">Bernoulli Fee</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  A base fee applied to every position, calculated as <span className="font-mono text-white">baseFee * p * (1 - p)</span> where p is the fair price.
                  This fee is maximized at 50/50 probability and approaches zero at extremes.
                </p>
              </div>
              <div className="border-t border-white/5 pt-6">
                <h3 className="text-sm font-bold text-white mb-2">Utilization Fee</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Scales with vault utilization — as more of the vault&apos;s balance is at risk,
                  the fee increases to protect LPs. Low utilization = low fees, high utilization = higher fees.
                </p>
              </div>
              <div className="border-t border-white/5 pt-6">
                <h3 className="text-sm font-bold text-white mb-2">Total Cost</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Your total cost per unit = <span className="font-mono text-white">Fair Price + Bernoulli Fee + Utilization Fee</span>.
                  This is capped below 1 so you can always profit if your position is correct.
                </p>
              </div>
            </motion.div>
          </div>

          {/* Settlement Process */}
          <div className="mb-20">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-8">Settlement Process</h2>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              className="bg-neutral-900/50 border border-white/5 rounded-2xl p-6 md:p-8"
            >
              <div className="flex flex-col gap-4">
                {[
                  { step: '1', label: 'Window Closes', desc: 'The 15-minute market window expires.' },
                  { step: '2', label: 'Oracle Reports', desc: 'Pyth Network reports the final BTC price to the Sui smart contract.' },
                  { step: '3', label: 'Settlement', desc: 'The DeepBook Predict contract compares settlement price vs strike. Winners are determined automatically.' },
                  { step: '4', label: 'Payout', desc: 'Winning positions receive 1 DUSDC per unit. Losing positions receive 0. Payouts are claimable immediately.' },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-lg bg-vermilion/10 text-vermilion flex items-center justify-center flex-shrink-0 font-bold text-xs">
                      {item.step}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">{item.label}</div>
                      <div className="text-sm text-gray-400">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* Privacy Architecture */}
          <div className="mb-20">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-8 flex items-center gap-2">
              <Shield className="w-4 h-4 text-sky-400" />
              On-Chain Architecture
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="bg-neutral-900/50 border border-sky-400/10 hover:border-sky-400/20 rounded-2xl p-6 transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-sky-400/10 flex items-center justify-center">
                    <EyeOff className="w-4 h-4 text-sky-400" />
                  </div>
                  <h3 className="text-base font-bold text-white">Transparent Positions</h3>
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Your position direction (Up/Down) and size are recorded <span className="text-sky-400 font-medium">transparently on-chain</span> through Sui smart contracts. Every position is verifiable and settled by DeepBook Predict with no intermediaries.
                </p>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 }}
                className="bg-neutral-900/50 border border-sky-400/10 hover:border-sky-400/20 rounded-2xl p-6 transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-sky-400/10 flex items-center justify-center">
                    <Lock className="w-4 h-4 text-sky-400" />
                  </div>
                  <h3 className="text-base font-bold text-white">Instant Finality</h3>
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Sui provides <span className="text-sky-400 font-medium">sub-second transaction finality</span>. Your positions are confirmed almost instantly, and when the market settles, payouts are distributed on-chain without delay.
                </p>
              </motion.div>
            </div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="bg-neutral-900/50 border border-sky-400/10 hover:border-sky-400/20 rounded-2xl p-6 transition-all"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-sky-400/10 flex items-center justify-center">
                  <Shield className="w-4 h-4 text-sky-400" />
                </div>
                <h3 className="text-base font-bold text-white">Smart Contract Settlement</h3>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">
                When a market settles, the <span className="text-sky-400 font-medium">DeepBook Predict smart contract</span> verifies your position on-chain and calculates your payout automatically. All funds are held and distributed by the contract — no trust required.
              </p>
            </motion.div>
          </div>

          {/* FAQ */}
          <div className="mb-20">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-8 flex items-center gap-2">
              <HelpCircle className="w-4 h-4" />
              FAQ
            </h2>
            <div className="space-y-2">
              {faqs.map((faq, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + index * 0.05 }}
                  className="bg-neutral-900/50 border border-white/5 rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full flex items-center justify-between p-5 text-left"
                  >
                    <h3 className="text-sm font-bold text-white">{faq.question}</h3>
                    <ChevronDown
                      className={`w-4 h-4 text-gray-500 flex-shrink-0 ml-4 transition-transform ${openFaq === index ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <AnimatePresence>
                    {openFaq === index && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <p className="text-sm text-gray-500 leading-relaxed px-5 pb-5">{faq.answer}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
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
              Get DUSDC, pick a side, and see if you can beat the market.
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

'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, Shield, Zap, TrendingUp, Lock, Users, CheckCircle, HelpCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';

export default function HowItWorksPage() {
  const router = useRouter();

  const steps = [
    {
      number: 1,
      title: 'Connect Your Wallet',
      description: 'Connect your Aleo wallet (Leo Wallet) to get started. No KYC, no email required.',
      icon: Shield,
    },
    {
      number: 2,
      title: 'Browse Markets',
      description: 'Explore prediction markets on various topics - politics, sports, crypto, and more.',
      icon: TrendingUp,
    },
    {
      number: 3,
      title: 'Choose Your Privacy',
      description: 'Decide if you want to bet publicly or privately using zero-knowledge proofs.',
      icon: Lock,
    },
    {
      number: 4,
      title: 'Place Your Bet',
      description: 'Select YES or NO, enter your amount, and confirm the transaction.',
      icon: Zap,
    },
  ];

  const features = [
    {
      icon: Shield,
      title: 'Privacy First',
      description: 'Choose between public and private bets. Private bets use zero-knowledge proofs to keep your positions completely confidential.',
    },
    {
      icon: Zap,
      title: 'Instant Settlement',
      description: 'All bets are settled on-chain with smart contracts. No middleman, no delays.',
    },
    {
      icon: TrendingUp,
      title: 'Real-Time Odds',
      description: 'Market odds update automatically based on supply and demand. Get the best prices.',
    },
    {
      icon: Users,
      title: 'Community Driven',
      description: 'Anyone can create markets. The community decides what to bet on.',
    },
  ];

  const faqs = [
    {
      question: 'What is a prediction market?',
      answer: 'A prediction market is a platform where you can bet on the outcome of future events. The market price reflects the collective wisdom of all participants.',
    },
    {
      question: 'How do private bets work?',
      answer: 'Private bets use zero-knowledge proofs (ZK-SNARKs) on the Aleo blockchain. Your position is completely private - no one can see what you bet or how much.',
    },
    {
      question: 'When can I claim my winnings?',
      answer: 'After a market resolves, winners can claim their winnings. You receive 2x your bet amount if you picked the correct outcome.',
    },
    {
      question: 'What fees do I pay?',
      answer: 'You pay network transaction fees in ALEO tokens. Creating a market costs 2 ALEO. Placing bets costs ~1 ALEO for gas fees.',
    },
    {
      question: 'How are markets resolved?',
      answer: 'Markets are resolved by their creators based on the stated criteria. Resolution happens after the end date specified in the market.',
    },
    {
      question: 'Can I trade my positions?',
      answer: 'Currently, positions cannot be traded. Once you bet, you must wait for market resolution to claim winnings.',
    },
  ];

  return (
    <div className="min-h-screen bg-black text-white selection:bg-off-blue/30 overflow-x-hidden">
      <div className="fixed inset-0 bg-noise opacity-[0.03] pointer-events-none z-50"></div>
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-off-blue/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-new-mint/10 blur-[120px] rounded-full"></div>
      </div>

      <Header />

      <main className="container mx-auto px-4 py-32 relative z-10">
        <div className="max-w-5xl mx-auto">
          {/* Back Button */}
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-12 text-sm font-bold uppercase tracking-widest group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back to Markets
          </button>

          {/* Header */}
          <div className="mb-20">
            <h1 className="text-6xl md:text-7xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-500 mb-6">
              How It Works
            </h1>
            <p className="text-2xl text-gray-400 max-w-3xl leading-relaxed">
              Privacy-first prediction markets on Aleo. Bet on anything. Stay anonymous if you want.
            </p>
          </div>

          {/* Getting Started Steps */}
          <div className="mb-32">
            <h2 className="text-4xl font-black uppercase tracking-tight mb-12">Getting Started</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {steps.map((step, index) => (
                <motion.div
                  key={step.number}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="relative group"
                >
                  <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 group-hover:border-off-blue/30 rounded-2xl transition-all" />
                  <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />
                  <div className="relative p-8">
                    <div className="flex items-start gap-6">
                      <div className="w-12 h-12 rounded-full bg-off-blue/20 flex items-center justify-center text-off-blue font-black text-xl flex-shrink-0">
                        {step.number}
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-black mb-3 flex items-center gap-3">
                          <step.icon className="w-5 h-5 text-off-blue" />
                          {step.title}
                        </h3>
                        <p className="text-gray-400 leading-relaxed">{step.description}</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Features Section */}
          <div className="mb-32">
            <h2 className="text-4xl font-black uppercase tracking-tight mb-12">Why Dart?</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="relative group"
                >
                  <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 group-hover:border-new-mint/30 rounded-2xl transition-all" />
                  <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />
                  <div className="relative p-8">
                    <div className="w-12 h-12 rounded-full bg-new-mint/20 flex items-center justify-center text-new-mint mb-6">
                      <feature.icon className="w-6 h-6" />
                    </div>
                    <h3 className="text-2xl font-black mb-4">{feature.title}</h3>
                    <p className="text-gray-400 leading-relaxed">{feature.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Privacy Explanation */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative mb-32"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-off-blue/10 to-new-mint/5 backdrop-blur-2xl border border-off-blue/20 rounded-3xl" />
            <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-3xl pointer-events-none" />
            <div className="relative p-12">
              <div className="flex items-start gap-6 mb-8">
                <div className="w-16 h-16 rounded-full bg-off-blue/20 flex items-center justify-center text-off-blue flex-shrink-0">
                  <Lock className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-4xl font-black mb-4">Zero-Knowledge Privacy</h2>
                  <p className="text-xl text-gray-300 leading-relaxed">
                    Powered by Aleo's zero-knowledge cryptography
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <CheckCircle className="w-5 h-5 text-off-green flex-shrink-0 mt-1" />
                  <p className="text-gray-300 leading-relaxed">
                    <strong className="text-white">Private Bets:</strong> Your position size and side (YES/NO) are completely hidden using zero-knowledge proofs.
                  </p>
                </div>
                <div className="flex items-start gap-4">
                  <CheckCircle className="w-5 h-5 text-off-green flex-shrink-0 mt-1" />
                  <p className="text-gray-300 leading-relaxed">
                    <strong className="text-white">Public Bets:</strong> Your bet is visible on-chain for transparency, but you can still remain pseudonymous.
                  </p>
                </div>
                <div className="flex items-start gap-4">
                  <CheckCircle className="w-5 h-5 text-off-green flex-shrink-0 mt-1" />
                  <p className="text-gray-300 leading-relaxed">
                    <strong className="text-white">You Choose:</strong> Every bet lets you decide between public or private. Mix and match for different strategies.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* FAQ Section */}
          <div className="mb-20">
            <h2 className="text-4xl font-black uppercase tracking-tight mb-12 flex items-center gap-4">
              <HelpCircle className="w-8 h-8 text-off-blue" />
              Frequently Asked Questions
            </h2>
            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="relative group"
                >
                  <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 group-hover:border-white/20 rounded-xl transition-all" />
                  <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />
                  <div className="relative p-6">
                    <h3 className="text-lg font-bold text-white mb-3">{faq.question}</h3>
                    <p className="text-gray-400 leading-relaxed">{faq.answer}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* CTA Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative text-center"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-new-mint/10 to-off-blue/5 backdrop-blur-2xl border border-new-mint/20 rounded-3xl" />
            <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-3xl pointer-events-none" />
            <div className="relative p-16">
              <h2 className="text-4xl font-black mb-6">Ready to Start Trading?</h2>
              <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
                Connect your wallet and make your first bet in under 60 seconds.
              </p>
              <button
                onClick={() => router.push('/')}
                className="px-12 py-5 bg-new-mint text-black font-black uppercase tracking-widest text-sm rounded-xl hover:bg-new-mint/90 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_50px_rgba(167,243,208,0.3)]"
              >
                Browse Markets
              </button>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, TrendingUp, Clock, Shield } from 'lucide-react';
import { useState, useEffect } from 'react';

// Mock Data for Animation
const FEATURED_MARKETS = [
    {
        category: 'Crypto',
        badgeColor: 'text-off-blue border-off-blue/30 bg-off-blue/20',
        question: 'Will Bitcoin hit $150k in 2026?',
        ends: 'Dec 31, 2026',
        volume: '$3.2M',
        yes: 68,
        chart: [30, 45, 35, 60, 55, 75, 70, 65, 70, 68]
    },
    {
        category: 'Tech',
        badgeColor: 'text-new-mint border-new-mint/30 bg-new-mint/20',
        question: 'Will AI pass the Turing Test this year?',
        ends: 'Nov 30, 2026',
        volume: '$8.5M',
        yes: 52,
        chart: [45, 48, 50, 49, 51, 53, 52, 54, 53, 52]
    },
    {
        category: 'Sports',
        badgeColor: 'text-off-green border-off-green/30 bg-off-green/20',
        question: 'Will Messi return to Barcelona?',
        ends: 'Aug 31, 2026',
        volume: '$4.2M',
        yes: 35,
        chart: [20, 25, 30, 28, 32, 35, 38, 34, 36, 35]
    }
];

export default function HeroSection() {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setIndex((prev) => (prev + 1) % FEATURED_MARKETS.length);
        }, 5000);
        return () => clearInterval(timer);
    }, []);

    const market = FEATURED_MARKETS[index];

    return (
        <section className="relative min-h-[95vh] flex flex-col justify-center pt-20 border-b border-white/10 overflow-hidden">

            {/* Background Image - Generated Premium Texture */}
            <div className="absolute inset-0 pointer-events-none opacity-40 mix-blend-screen">
                <img src="/hero-bg.png" alt="Background" className="w-full h-full object-cover opacity-50" />
                <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
                <div className="absolute inset-0 bg-gradient-to-r from-black via-transparent to-transparent" />
            </div>

            <div className="container mx-auto px-6 z-10">
                <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">

                    {/* Left Column: Content */}
                    <div>

                        {/* Massive Headline */}
                        <motion.h1
                            initial={{ opacity: 0, y: 40 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                            className="text-5xl md:text-9xl font-black tracking-tighter mb-8 leading-[0.9] text-white"
                        >
                            PREDICT<br />
                            THE<br />
                            <span className="text-white/50">UNSEEN.</span>
                        </motion.h1>

                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            className="text-xl text-gray-400 max-w-xl leading-relaxed mb-10"
                        >
                            The world's first privacy-first prediction market.
                            Zero-knowledge betting on global events.
                        </motion.p>

                        {/* CTA Buttons - High Contrast */}
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.5 }}
                            className="flex flex-col sm:flex-row gap-4"
                        >
                            <button className="w-full sm:w-auto h-14 px-8 bg-[#34D399] text-black font-bold text-lg hover:bg-white hover:scale-105 transition-all flex items-center justify-center gap-3 rounded-full shadow-[0_0_20px_rgba(52,211,153,0.3)]">
                                START TRADING <ArrowRight className="w-5 h-5" />
                            </button>
                            <button className="w-full sm:w-auto h-14 px-8 bg-transparent text-white font-bold text-lg border border-white/20 hover:border-white hover:bg-white/5 transition-all rounded-full">
                                VIEW MARKETS
                            </button>
                        </motion.div>
                    </div>

                    {/* Right Column: Feature Card (Floating & Flipping) */}
                    <div className="relative hidden lg:block h-full min-h-[600px] flex items-center justify-center perspective-[1000px]">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={index}
                                initial={{ opacity: 0, rotateX: -90, y: 50 }}
                                animate={{ opacity: 1, rotateX: 0, y: 0 }}
                                exit={{ opacity: 0, rotateX: 90, y: -50 }}
                                transition={{ duration: 0.6, ease: "backOut" }}
                                className="relative z-10 w-full max-w-xl"
                            >
                                {/* Card Body */}
                                <div className="relative bg-neutral-900/40 backdrop-blur-xl border border-white/10 p-8 rounded-3xl shadow-2xl">

                                    {/* Card Header */}
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="flex gap-2">
                                            <div className={`px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border ${market.badgeColor}`}>
                                                {market.category}
                                            </div>
                                            <div className="bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                                                <span className="relative flex h-2 w-2">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-400"></span>
                                                </span>
                                                Hot
                                            </div>
                                        </div>
                                        <Shield className="w-5 h-5 text-gray-500" />
                                    </div>

                                    {/* Question */}
                                    <div className="h-24"> {/* Fixed height to prevent layout jump */}
                                        <h3 className="text-3xl font-black text-white leading-tight mb-2 line-clamp-2">
                                            {market.question}
                                        </h3>
                                        <p className="text-gray-400 text-sm font-mono">
                                            Ends {market.ends} • {market.volume} Volume
                                        </p>
                                    </div>

                                    {/* Chart Placeholder */}
                                    <div className="h-24 flex items-end gap-1 mb-8 opacity-50">
                                        {market.chart.map((h, i) => (
                                            <div
                                                key={i}
                                                className="flex-1 bg-gradient-to-t from-off-green/20 to-off-green rounded-t-sm"
                                                style={{ height: `${h}%` }}
                                            />
                                        ))}
                                    </div>

                                    {/* Interactive Betting Bars */}
                                    <div className="space-y-3">
                                        {/* Yes Bar */}
                                        <div className="h-16 bg-neutral-950 rounded-2xl flex items-center p-2 border border-white/5 relative overflow-hidden group hover:border-off-green/50 transition-colors cursor-pointer">
                                            <div className="absolute inset-y-0 left-0 bg-off-green/10 transition-all duration-1000" style={{ width: `${market.yes}%` }} />
                                            <div className="relative z-10 flex justify-between w-full px-4">
                                                <span className="font-bold text-off-green uppercase tracking-wider">Yes</span>
                                                <span className="font-mono font-bold text-white text-xl">{market.yes}%</span>
                                            </div>
                                        </div>

                                        {/* No Bar */}
                                        <div className="h-16 bg-neutral-950 rounded-2xl flex items-center p-2 border border-white/5 relative overflow-hidden group hover:border-off-red/50 transition-colors cursor-pointer">
                                            <div className="absolute inset-y-0 left-0 bg-off-red/10 transition-all duration-1000" style={{ width: `${100 - market.yes}%` }} />
                                            <div className="relative z-10 flex justify-between w-full px-4">
                                                <span className="font-bold text-off-red uppercase tracking-wider">No</span>
                                                <span className="font-mono font-bold text-white text-xl">{100 - market.yes}%</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Footer info */}
                                    <div className="mt-6 flex justify-between items-center text-xs text-gray-500 font-mono uppercase tracking-widest">
                                        <span>Pool: {market.volume}</span>
                                        <span>4,102 Traders</span>
                                    </div>
                                </div>

                                {/* Decorative Blur blob behind card */}
                                <div className="absolute -inset-10 bg-new-mint/20 blur-[100px] -z-10 rounded-full mix-blend-screen pointer-events-none" />
                            </motion.div>
                        </AnimatePresence>
                    </div>

                </div>
            </div>
        </section>
    );
}

'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Clock, Info, ChevronRight, ChevronLeft, ArrowUpRight } from 'lucide-react';
import MiniPriceChart from './charts/MiniPriceChart';
import type { Market } from './MarketCard';

interface FeaturedHeroProps {
    market: Market;
}

export default function FeaturedHero({ market }: FeaturedHeroProps) {
    const [activeSide, setActiveSide] = useState<'YES' | 'NO'>('YES');

    // Mock data for the detailed view
    const outcomes = [
        { name: 'Jannik Sinner', price: 86, change: 14, isUp: true },
        { name: 'Novak Djokovic', price: 12, change: 3, isUp: false }
    ];

    return (
        <div className="w-full relative group isolation-auto mb-8">
            {/* Award-Winning Glow Effect */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-new-mint/20 via-new-blue/20 to-new-pink/20 rounded-[18px] opacity-0 group-hover:opacity-100 blur-xl transition-all duration-700" />

            <div className="relative w-full bg-neutral-900/60 backdrop-blur-2xl border border-white/5 rounded-2xl overflow-hidden ring-1 ring-white/5 transition-all duration-500 group-hover:shadow-2xl">

                {/* Subtle Noise Texture overlay could go here */}

                {/* Header Bar */}
                <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-4">
                        {/* Live Pulse Dot for Title */}
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                        <h2 className="text-3xl font-black text-white tracking-tighter drop-shadow-lg">
                            {market.question}
                        </h2>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex bg-black/40 rounded-full p-1 border border-white/5">
                            <button className="p-2 rounded-full hover:bg-white/10 text-gray-500 hover:text-white transition-all hover:scale-110">
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <span className="flex items-center px-4 text-xs font-mono font-bold text-gray-400 tracking-widest">
                                TOP EVENT
                            </span>
                            <button className="p-2 rounded-full hover:bg-white/10 text-gray-500 hover:text-white transition-all hover:scale-110">
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">

                    {/* Left Side: Order Book / Outcomes */}
                    <div className="lg:col-span-5 p-8 border-r border-white/5 flex flex-col justify-between bg-gradient-to-b from-white/[0.02] to-transparent">
                        <div>
                            <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] mb-6">
                                <span>Outcome</span>
                                <div className="flex gap-10 px-4">
                                    <span>Bid</span>
                                    <span>Ask</span>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {outcomes.map((outcome, idx) => (
                                    <div key={idx} className="group/row cursor-pointer relative">
                                        {/* Row Hover Gradient */}
                                        <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent rounded-xl opacity-0 group-hover/row:opacity-100 transition-opacity duration-300" />

                                        <div className="relative flex items-center justify-between p-4 rounded-xl border border-transparent group-hover/row:border-white/5 transition-all">
                                            <div className="flex items-center gap-3">
                                                {/* Side Color Indicator */}
                                                <div className={`w-1 h-8 rounded-full ${idx === 0 ? 'bg-new-mint shadow-[0_0_10px_rgba(52,211,153,0.4)]' : 'bg-gray-700'}`} />
                                                <div>
                                                    <span className="block font-bold text-lg text-white group-hover/row:text-new-mint transition-colors">{outcome.name}</span>
                                                    {idx === 0 && <span className="text-[10px] font-mono text-new-mint tracking-wider">▲ TRENDING</span>}
                                                </div>
                                            </div>

                                            <div className="flex gap-3">
                                                <div className={`w-14 h-10 rounded-lg flex items-center justify-center text-base font-bold transition-all duration-300 ${idx === 0 ? 'bg-new-mint/10 text-new-mint border border-new-mint/20 group-hover/row:bg-new-mint/20' : 'bg-white/5 text-gray-400 border border-white/5'}`}>
                                                    {outcome.price}¢
                                                </div>
                                                <div className="w-14 h-10 rounded-lg flex items-center justify-center text-sm font-bold bg-black/40 text-gray-600 border border-white/5 group-hover/row:border-white/10 group-hover/row:text-gray-400 transition-all">
                                                    {outcome.price + 1}¢
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mt-8 pt-8 border-t border-white/5">
                            <div className="flex items-center justify-between text-sm text-gray-400 mb-3">
                                <div className="flex items-center gap-2 group/stat">
                                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover/stat:bg-new-mint/20 transition-colors">
                                        <TrendingUp className="w-4 h-4 group-hover/stat:text-new-mint transition-colors" />
                                    </div>
                                    <span className="font-medium text-gray-400 group-hover/stat:text-white transition-colors">${(market.total_volume / 1000).toFixed(1)}k Volume</span>
                                </div>
                                <button className="flex items-center gap-2 text-new-blue hover:text-white transition-colors text-xs font-bold uppercase tracking-wider group/link">
                                    <span>Market Specs</span>
                                    <ArrowUpRight className="w-3 h-3 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Right Side: Graph & Live Status */}
                    <div className="lg:col-span-7 p-0 bg-black/40 relative overflow-hidden">

                        {/* Ambient Background Glows */}
                        <div className="absolute top-[-50%] right-[-10%] w-[400px] h-[400px] bg-new-mint/5 blur-[100px] rounded-full pointer-events-none" />
                        <div className="absolute bottom-[-50%] left-[-10%] w-[300px] h-[300px] bg-new-blue/5 blur-[80px] rounded-full pointer-events-none" />

                        <div className="p-8 relative z-10">
                            {/* Graph Overlay UI */}
                            <div className="flex justify-between items-start mb-12">
                                <div>
                                    <span className="text-6xl font-black text-white tracking-tighter block mb-2 drop-shadow-2xl">88%</span>
                                    <div className="flex items-center gap-3">
                                        <span className="px-2 py-1 rounded bg-new-mint/20 border border-new-mint/20 text-xs font-bold text-new-mint flex items-center gap-1">
                                            <TrendingUp className="w-3 h-3" /> 14%
                                        </span>
                                        <span className="text-sm font-medium text-gray-400">Probability of <span className="text-white">Yes</span></span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-xl">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                    </span>
                                    <span className="text-[10px] font-bold text-gray-300 tracking-widest uppercase">Live Trading</span>
                                </div>
                            </div>

                            {/* Chart Container */}
                            <div className="h-[280px] w-full relative -mx-4">
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10" />
                                <MiniPriceChart color="#34D399" className="opacity-90" />
                            </div>

                            {/* Time Range Tabs */}
                            <div className="flex justify-center mt-4">
                                <div className="flex bg-black/40 backdrop-blur-md p-1 rounded-xl border border-white/5">
                                    {['1H', '4H', '1D', '1W', 'ALL'].map((range) => (
                                        <button
                                            key={range}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${range === '1D' ? 'bg-white/15 text-white shadow-lg shadow-white/5' : 'text-gray-600 hover:text-white hover:bg-white/5'}`}
                                        >
                                            {range}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

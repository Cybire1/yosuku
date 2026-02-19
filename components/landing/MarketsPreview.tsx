'use client';

import { motion } from 'framer-motion';
import MarketCard, { Market } from '@/components/MarketCard';
import { ArrowUpRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Mock data to preview the DART platform features
const mockMarkets: Market[] = [
    {
        id: 101,
        question: "Will Bitcoin breach $100,000 before Q4?",
        end_timestamp: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days
        total_yes_shares: 450000,
        total_no_shares: 210000,
        total_volume: 1250000,
        resolved: false,
        category: "Crypto"
    },
    {
        id: 102,
        question: "Will the SEC approve a Solana ETF this year?",
        end_timestamp: Math.floor(Date.now() / 1000) + 86400 * 15,
        total_yes_shares: 120000,
        total_no_shares: 340000,
        total_volume: 850000,
        resolved: false,
        category: "Regulation"
    },
    {
        id: 103,
        question: "Will Ethereum gas fees drop below 5 gwei on average?",
        end_timestamp: Math.floor(Date.now() / 1000) + 86400 * 7,
        total_yes_shares: 80000,
        total_no_shares: 85000,
        total_volume: 320000,
        resolved: false,
        category: "Network"
    }
];

export default function MarketsPreview() {
    const router = useRouter();
    const [isHovered, setIsHovered] = useState(false);

    // Ochi-style curve
    const ease = [0.76, 0, 0.24, 1] as const;

    return (
        <section className="relative w-full min-h-screen bg-[#030303] py-32 px-6 sm:px-12 md:px-[50px] overflow-hidden">

            {/* Subtle background texture */}
            <div className="absolute inset-0 bg-[#030303] bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none mix-blend-overlay z-0" />

            <div className="relative z-10 w-full max-w-7xl mx-auto">

                {/* Section Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-20 gap-8">
                    <div className="textstructure">
                        <div className="masker overflow-hidden">
                            <motion.h2
                                initial={{ y: "100%" }}
                                whileInView={{ y: "0%" }}
                                viewport={{ once: true, margin: "-100px" }}
                                transition={{ ease, duration: 1 }}
                                className="font-extrabold uppercase text-5xl md:text-7xl lg:text-[7vw] leading-[0.85] tracking-tighter text-white"
                            >
                                LIVE MARKETS
                            </motion.h2>
                        </div>
                        <div className="masker overflow-hidden mt-2">
                            <motion.p
                                initial={{ y: "100%" }}
                                whileInView={{ y: "0%" }}
                                viewport={{ once: true, margin: "-100px" }}
                                transition={{ ease, duration: 1, delay: 0.1 }}
                                className="text-zinc-400 font-light text-lg md:text-xl max-w-lg"
                            >
                                Zero-knowledge prediction pools resolving instantly on-chain.
                            </motion.p>
                        </div>
                    </div>

                    {/* View All Markets Button */}
                    <div className="group flex items-center gap-3">
                        <motion.button
                            onMouseEnter={() => setIsHovered(true)}
                            onMouseLeave={() => setIsHovered(false)}
                            onClick={() => router.push('/markets')}
                            className="relative overflow-hidden px-8 py-3 border-[1px] border-zinc-700 rounded-full font-light text-sm tracking-widest uppercase cursor-pointer transition-colors duration-300"
                            animate={{ backgroundColor: isHovered ? "#ffffff" : "transparent", color: isHovered ? "#000000" : "#ffffff" }}
                            data-cursor-text="Explore"
                        >
                            <span className="relative z-10 font-bold">View All</span>
                        </motion.button>
                    </div>
                </div>

                {/* Asymmetrical Bento Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2 gap-6 relative">
                    {mockMarkets.map((market, index) => {
                        // Ensure the first market spans massive columns to create the bento box irregularity
                        const bentoClasses = index === 0
                            ? "md:col-span-2 lg:col-span-2 lg:row-span-2"
                            : "md:col-span-1 lg:col-span-2 lg:row-span-1";

                        return (
                            <motion.div
                                key={market.id}
                                className={bentoClasses}
                                initial={{ opacity: 0, y: 50 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, margin: "-50px" }}
                                transition={{ ease, duration: 1, delay: index * 0.15 }}
                                data-cursor-text="Bet" // Custom cursor integration
                            >
                                <div className="w-full h-full">
                                    {/* Wrapping the MarketCard to ensure it fills the bento cell */}
                                    <MarketCard market={market} />
                                </div>
                            </motion.div>
                        );
                    })}
                </div>

            </div>
        </section>
    );
}

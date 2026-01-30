'use client';

import { motion } from 'framer-motion';

const TICKER_ITEMS = [
    { label: 'BTC > $100k', value: 'YES 55%', change: '↑', up: true },
    { label: 'ETH MERGE', value: 'RESOLVED', change: '✓', up: true },
    { label: 'US ELECTION', value: 'TRUMP 45%', change: '↓', up: false },
    { label: 'FED RATES', value: 'NO CUT', change: '→', up: true },
    { label: 'SOLANA ATH', value: 'YES 30%', change: '↑', up: true },
    { label: 'NBA FINALS', value: 'LAKERS', change: '↓', up: false },
    { label: 'SPACEX', value: 'SUCCESS', change: '↑', up: true },
];

export default function TickerStrip() {
    return (
        <div className="w-full bg-black border-y border-white/10 overflow-hidden py-4 select-none">
            <div className="flex whitespace-nowrap">
                <motion.div
                    className="flex gap-16 px-4"
                    animate={{ x: [0, -1000] }}
                    transition={{
                        repeat: Infinity,
                        duration: 40,
                        ease: "linear",
                    }}
                >
                    {/* Repeat list multiple times for seamless loop */}
                    {[...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS].map((item, idx) => (
                        <div key={idx} className="flex items-center gap-4 text-xs font-mono tracking-widest uppercase group cursor-pointer hover:opacity-50 transition-opacity">
                            <span className="text-gray-500 group-hover:text-white transition-colors">{item.label}</span>
                            <span className="text-white font-bold">
                                {item.value}
                            </span>
                            <span className="text-white">
                                {item.change}
                            </span>
                        </div>
                    ))}
                </motion.div>
            </div>
        </div>
    );
}

'use client';

import { motion } from 'framer-motion';

const LEADERS = [
    { rank: '01', name: 'aleo1...x92p', winRate: '88%', profit: '12,450' },
    { rank: '02', name: 'aleo1...k3m2', winRate: '82%', profit: '9,120' },
    { rank: '03', name: 'aleo1...v8n4', winRate: '79%', profit: '8,350' },
    { rank: '04', name: 'aleo1...p2q1', winRate: '76%', profit: '6,200' },
    { rank: '05', name: 'aleo1...m5r8', winRate: '75%', profit: '5,100' },
];

export default function Leaderboard() {
    return (
        <section className="py-32 bg-black border-t border-white/10">
            <div className="container mx-auto px-4 max-w-5xl">
                <div className="mb-20 text-center">
                    <span className="text-xs font-mono text-gray-500 uppercase tracking-[0.2em] mb-4 block">
                        Top Performers
                    </span>
                    <h2 className="text-4xl md:text-6xl font-black text-white tracking-tighter uppercase">
                        Leaderboard
                    </h2>
                </div>

                <div className="border-t border-white/20">
                    {/* Header */}
                    <div className="grid grid-cols-4 py-4 text-xs font-mono uppercase tracking-wider text-gray-500">
                        <div>Rank</div>
                        <div>User</div>
                        <div className="text-right">Rate</div>
                        <div className="text-right">Profit (ALEO)</div>
                    </div>

                    {/* Rows */}
                    {LEADERS.map((leader, index) => (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, scaleY: 0 }}
                            whileInView={{ opacity: 1, scaleY: 1 }}
                            transition={{ duration: 0.4, delay: index * 0.1 }}
                            viewport={{ once: true }}
                            className="group border-b border-white/10 hover:border-white transition-colors cursor-default"
                        >
                            <div className="grid grid-cols-4 py-8 items-center text-sm">
                                <div className="font-mono text-gray-500 group-hover:text-white transition-colors">
                                    {leader.rank}
                                </div>
                                <div className="font-mono text-gray-300 group-hover:text-white transition-colors">
                                    {leader.name}
                                </div>
                                <div className="text-right font-bold text-gray-400 group-hover:text-white transition-colors">
                                    {leader.winRate}
                                </div>
                                <div className="text-right font-mono text-white group-hover:underline decoration-1 underline-offset-4">
                                    +{leader.profit}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>

                <div className="mt-12 text-center">
                    <button className="text-sm font-bold uppercase tracking-widest border-b border-transparent hover:border-white pb-1 transition-all">
                        View Full Rankings
                    </button>
                </div>
            </div>
        </section>
    );
}

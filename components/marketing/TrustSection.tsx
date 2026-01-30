'use client';

import { motion } from 'framer-motion';

export default function TrustSection() {
    return (
        <section className="py-40 bg-black border-t border-white/10 relative overflow-hidden">
            {/* Background typographic texture */}
            <div className="absolute inset-0 flex items-center justify-center opacity-[0.02] pointer-events-none select-none">
                <span className="text-[20vw] font-black leading-none text-white">
                    ZERO
                </span>
            </div>

            <div className="container mx-auto px-4 text-center relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    viewport={{ once: true }}
                >
                    <h2 className="text-4xl md:text-7xl font-black mb-12 tracking-tighter uppercase leading-[0.9]">
                        Powered by<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-600">
                            Zero Knowledge
                        </span>
                    </h2>

                    <div className="grid md:grid-cols-2 gap-16 max-w-4xl mx-auto text-left">
                        <div className="border-l border-white/20 pl-8">
                            <h3 className="text-xl font-bold text-white mb-4 uppercase tracking-widest">
                                Private Positions
                            </h3>
                            <p className="text-gray-500 leading-relaxed text-lg">
                                Your bets are encrypted locally. The market knows <i>that</i> a bet happened, but not <i>what</i> was bet, until you choose to reveal it.
                            </p>
                        </div>

                        <div className="border-l border-white/20 pl-8">
                            <h3 className="text-xl font-bold text-white mb-4 uppercase tracking-widest">
                                Verifiable Truth
                            </h3>
                            <p className="text-gray-500 leading-relaxed text-lg">
                                Math doesn't lie. Aleo's zk-proofs ensure that payouts are calculated correctly without trusting a central authority.
                            </p>
                        </div>
                    </div>

                    <div className="mt-20">
                        <button className="px-12 py-5 bg-white text-black font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors rounded-full">
                            Read the Whitepaper
                        </button>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}

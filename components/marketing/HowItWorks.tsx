'use client';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

const STEPS = [
    {
        number: '01',
        title: 'Connect',
        description: 'Link your Leo Wallet. No email. No signup.',
    },
    {
        number: '02',
        title: 'Privacy',
        description: 'Toggle Incognito. Your trades become invisible.',
    },
    {
        number: '03',
        title: 'Trade',
        description: 'Predict outcomes. Win instantly on resolution.',
    },
];

export default function HowItWorks() {
    return (
        <section className="py-32 bg-black border-t border-white/10">
            <div className="container mx-auto px-4">
                <div className="flex flex-col md:flex-row justify-between items-end mb-24">
                    <h2 className="text-4xl md:text-6xl font-black text-white tracking-tighter uppercase leading-[0.9]">
                        The<br />
                        Process
                    </h2>
                    <p className="text-gray-500 max-w-sm text-sm mt-8 md:mt-0 font-mono text-right uppercase tracking-widest">
                        Simple. Secure. Private.
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-px bg-white/10 border border-white/10">
                    {STEPS.map((step, index) => (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: index * 0.2 }}
                            viewport={{ once: true }}
                            className="bg-black p-12 min-h-[400px] flex flex-col justify-between group hover:bg-neutral-900 transition-colors duration-500"
                        >
                            <div className="flex justify-between items-start">
                                <span className="text-sm font-mono text-gray-600 group-hover:text-white transition-colors">
                                    ({step.number})
                                </span>
                                <ArrowRight className="w-5 h-5 text-gray-700 -rotate-45 group-hover:text-white group-hover:rotate-0 transition-all duration-500" />
                            </div>

                            <div>
                                <h3 className="text-3xl font-bold text-white mb-4 tracking-tight">
                                    {step.title}
                                </h3>
                                <p className="text-gray-500 leading-relaxed text-sm max-w-[200px] group-hover:text-gray-400 transition-colors">
                                    {step.description}
                                </p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}

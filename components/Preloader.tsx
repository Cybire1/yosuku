'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Preloader() {
    const [loading, setLoading] = useState(() => {
        if (typeof window !== 'undefined') {
            return !sessionStorage.getItem('preloaderShown');
        }
        return true;
    });
    const [count, setCount] = useState(0);

    useEffect(() => {
        // Skip if already shown this session
        if (!loading) return;

        // Simulating loading progress
        const duration = 2000; // 2 seconds total load time
        const interval = 20;
        const steps = duration / interval;
        const increment = 100 / steps;

        const timer = setInterval(() => {
            setCount((prev) => {
                const next = prev + increment;
                if (next >= 100) {
                    clearInterval(timer);
                    setTimeout(() => {
                        sessionStorage.setItem('preloaderShown', '1');
                        setLoading(false);
                    }, 800); // Slight delay at 100%
                    return 100;
                }
                return next;
            });
        }, interval);

        return () => clearInterval(timer);
    }, [loading]);

    return (
        <AnimatePresence mode="wait">
            {loading && (
                <>
                    {/* Main Container - Absolute positioning to cover screen */}
                    <motion.div
                        className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black overflow-hidden pointer-events-none"
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.8, ease: "easeInOut", delay: 0.4 }}
                    >
                        {/* Counter Text */}
                        <div className="relative z-10 overflow-hidden">
                            <motion.h1
                                className="text-9xl md:text-[12rem] font-black tracking-tighter text-white tabular-nums leading-none"
                                initial={{ y: 100, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={{ y: -100, opacity: 0 }}
                                transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
                            >
                                {Math.round(count)}%
                            </motion.h1>
                        </div>

                        {/* Loading Bar (Optional Minimalist Line) */}
                        <motion.div
                            className="w-64 h-1 bg-white/10 mt-8 rounded-full overflow-hidden"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <motion.div
                                className="h-full bg-new-mint"
                                style={{ width: `${count}%` }}
                            />
                        </motion.div>

                    </motion.div>

                    {/* Curtain Reveal Panels (Top/Bottom Split) */}
                    <motion.div
                        className="fixed top-0 left-0 w-full h-1/2 bg-neutral-950 z-[9998]"
                        initial={{ y: 0 }}
                        exit={{ y: "-100%" }}
                        transition={{ duration: 1, ease: [0.76, 0, 0.24, 1], delay: 0.2 }}
                    />
                    <motion.div
                        className="fixed bottom-0 left-0 w-full h-1/2 bg-neutral-950 z-[9998]"
                        initial={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ duration: 1, ease: [0.76, 0, 0.24, 1], delay: 0.2 }}
                    />
                </>
            )}
        </AnimatePresence>
    );
}

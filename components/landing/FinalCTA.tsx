'use client';

import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useRouter } from 'next/navigation';

export default function FinalCTA() {
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement>(null);

    // Mouse position values
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    // Spring physics for smooth parallax
    const springX = useSpring(mouseX, { stiffness: 150, damping: 20 });
    const springY = useSpring(mouseY, { stiffness: 150, damping: 20 });

    // Inverse parallax transform
    const x = useTransform(springX, [-0.5, 0.5], [50, -50]);
    const y = useTransform(springY, [-0.5, 0.5], [50, -50]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();

        // Calculate normalized mouse position (-0.5 to 0.5)
        const xPct = (e.clientX - rect.left) / rect.width - 0.5;
        const yPct = (e.clientY - rect.top) / rect.height - 0.5;

        mouseX.set(xPct);
        mouseY.set(yPct);
    };

    const handleMouseLeave = () => {
        // Snap back to center
        mouseX.set(0);
        mouseY.set(0);
    };

    // Ochi-style ease curve
    const ease = [0.76, 0, 0.24, 1] as const;

    return (
        <section
            ref={containerRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="relative flex h-[80vh] w-full cursor-pointer flex-col items-center justify-center overflow-hidden bg-black group"
            onClick={() => router.push('/markets')}
            data-cursor-text="Deploy"
        >
            {/* The dramatic background that scales up on hover */}
            <div className="absolute inset-0 bg-white origin-bottom scale-y-0 group-hover:scale-y-100 transition-transform duration-700 ease-[cubic-bezier(0.76,0,0.24,1)]" />

            {/* Massive typography with Parallax */}
            <motion.div
                style={{ x, y }}
                className="relative z-10 text-center mix-blend-difference pointer-events-none"
            >
                <div className="masker overflow-hidden">
                    <motion.h1
                        initial={{ y: "100%" }}
                        whileInView={{ y: "0%" }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ ease, duration: 1 }}
                        className="text-[14vw] font-black uppercase text-white leading-[0.8] tracking-tighter"
                    >
                        START
                    </motion.h1>
                </div>
                <div className="masker overflow-hidden">
                    <motion.h1
                        initial={{ y: "100%" }}
                        whileInView={{ y: "0%" }}
                        viewport={{ once: true, margin: "-100px" }}
                        transition={{ ease, duration: 1, delay: 0.1 }}
                        className="text-[14vw] font-black uppercase text-white leading-[0.8] tracking-tighter"
                    >
                        PREDICTING
                    </motion.h1>
                </div>
            </motion.div>

            {/* Small instructional text */}
            <motion.p
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5, duration: 1 }}
                className="absolute bottom-12 z-10 text-sm font-medium uppercase tracking-widest text-white/40 transition-colors group-hover:text-black mix-blend-overlay"
            >
                [ Click anywhere to launch the dashboard ]
            </motion.p>
        </section>
    );
}

'use client';

import { motion } from 'framer-motion';

export default function TextReveal({
    text,
    className = "",
    delay = 0
}: {
    text: string;
    className?: string;
    delay?: number;
}) {
    // Sharp Ochi-style ease curve
    const ease = [0.76, 0, 0.24, 1] as const;

    // Split the text into an array of letters. 
    // We treat spaces as special characters to preserve spacing.
    const letters = text.split("");

    const containerVariants = {
        hidden: { opacity: 1 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.03, // The delay between each letter popping up
                delayChildren: delay,
            }
        }
    };

    const letterVariants = {
        hidden: { y: "100%" },
        visible: {
            y: "0%",
            transition: { ease, duration: 1 }
        }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className={`flex items-baseline overflow-hidden ${className}`}
        >
            {letters.map((letter, index) => (
                <motion.span
                    key={index}
                    variants={letterVariants}
                    className="inline-block"
                    style={{ whiteSpace: letter === " " ? "pre" : "normal" }}
                >
                    {letter}
                </motion.span>
            ))}
        </motion.div>
    );
}

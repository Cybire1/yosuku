'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

/**
 * AnimatedNumber
 * A generic slot-machine style rolling number component for high-action intense UI.
 * Scrambles and rolls up/down when the `value` prop changes.
 */
export default function AnimatedNumber({
    value,
    className = '',
}: {
    value: number | string;
    className?: string;
}) {
    const [displayValue, setDisplayValue] = useState(value);
    const [isAnimating, setIsAnimating] = useState(false);

    useEffect(() => {
        if (value !== displayValue) {
            setIsAnimating(true);
            const timeout = setTimeout(() => {
                setDisplayValue(value);
                setIsAnimating(false);
            }, 300); // 300ms flip duration
            return () => clearTimeout(timeout);
        }
    }, [value, displayValue]);

    return (
        <div className={`relative inline-block overflow-hidden ${className}`}>
            <motion.div
                key={value}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -20, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
                {displayValue}
            </motion.div>
        </div>
    );
}

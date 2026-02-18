'use client';

import { useState, useEffect, useRef } from 'react';

export default function PriceTicker({ price, className = '' }: { price: number, className?: string }) {
    const [flash, setFlash] = useState<'up' | 'down' | null>(null);
    const prevPriceRef = useRef(price);

    useEffect(() => {
        // Determine tick direction
        if (prevPriceRef.current > 0) {
            if (price > prevPriceRef.current) setFlash('up');
            else if (price < prevPriceRef.current) setFlash('down');
        }
        prevPriceRef.current = price;

        // Clear flash
        const t = setTimeout(() => setFlash(null), 600);
        return () => clearTimeout(t);
    }, [price]);

    return (
        <span className={`transition-all duration-300 ${flash === 'up' ? 'text-new-mint drop-shadow-[0_0_15px_rgba(52,211,153,0.8)] scale-105' :
                flash === 'down' ? 'text-off-red drop-shadow-[0_0_15px_rgba(244,63,94,0.8)] scale-105' :
                    ''
            } inline-block transform ${className}`}
        >
            ${price > 0 ? price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '---'}
        </span>
    );
}

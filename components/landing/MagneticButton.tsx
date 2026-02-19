'use client';

import { useRef, useState, useEffect } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

export default function MagneticButton({
    children,
    className = "",
    onClick,
    onMouseEnter,
    onMouseLeave
}: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);

    // Motion values to track the pointer offset
    const x = useMotionValue(0);
    const y = useMotionValue(0);

    // Spring physics for a smooth, high-end "snap"
    const springX = useSpring(x, { stiffness: 150, damping: 15, mass: 0.1 });
    const springY = useSpring(y, { stiffness: 150, damping: 15, mass: 0.1 });

    const handleMouseMove = (e: MouseEvent) => {
        if (!ref.current) return;

        // Get the element's bounding box to calculate center
        const { left, top, width, height } = ref.current.getBoundingClientRect();
        const centerX = left + width / 2;
        const centerY = top + height / 2;

        // Calculate distance from center
        const distanceX = e.clientX - centerX;
        const distanceY = e.clientY - centerY;

        // Apply a subtle pull multiplier (e.g., 0.3 means it moves 30% of the distance)
        x.set(distanceX * 0.3);
        y.set(distanceY * 0.3);
    };

    useEffect(() => {
        if (isHovered) {
            window.addEventListener("mousemove", handleMouseMove);
        } else {
            window.removeEventListener("mousemove", handleMouseMove);
            // Snap back to center when hover ends
            x.set(0);
            y.set(0);
        }

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
        };
    }, [isHovered, x, y]);

    return (
        <motion.div
            ref={ref}
            style={{ x: springX, y: springY }}
            onMouseEnter={() => {
                setIsHovered(true);
                onMouseEnter?.();
            }}
            onMouseLeave={() => {
                setIsHovered(false);
                onMouseLeave?.();
            }}
            onClick={onClick}
            className={`relative inline-block ${className}`}
        >
            {/* 
         Inside the magnetic wrapper, we can also apply a subtle counter-parallax 
         to the text itself if desired, but for Ochi-style brutalism, 
         just moving the whole button is often cleaner. 
      */}
            {children}
        </motion.div>
    );
}

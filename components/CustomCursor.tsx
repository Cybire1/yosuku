'use client';

import { useEffect, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

export default function CustomCursor() {
    const [isHovering, setIsHovering] = useState(false);
    const [hoverText, setHoverText] = useState('');

    // Track raw mouse position
    const mouseX = useMotionValue(-100);
    const mouseY = useMotionValue(-100);

    // Smooth the mouse values for the main cursor dot
    const springConfigDot = { damping: 25, stiffness: 300, mass: 0.5 };
    const smoothX = useSpring(mouseX, springConfigDot);
    const smoothY = useSpring(mouseY, springConfigDot);

    // Smooth the mouse values for the larger ring ring
    const springConfigRing = { damping: 20, stiffness: 150, mass: 0.8 };
    const smoothRingX = useSpring(mouseX, springConfigRing);
    const smoothRingY = useSpring(mouseY, springConfigRing);

    useEffect(() => {
        // Hide default cursor
        document.body.style.cursor = 'none';

        const handleMouseMove = (e: MouseEvent) => {
            mouseX.set(e.clientX);
            mouseY.set(e.clientY);
        };

        const handleMouseOver = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            // Check if we are hovering over an interactive element
            const isInteractive = window.getComputedStyle(target).cursor === 'pointer' || target.tagName === 'A' || target.tagName === 'BUTTON';

            // Look for a specific data attribute for custom cursor text
            const customText = target.closest('[data-cursor-text]')?.getAttribute('data-cursor-text');

            if (customText) {
                setIsHovering(true);
                setHoverText(customText);
            } else if (isInteractive) {
                setIsHovering(true);
                setHoverText('');
            } else {
                setIsHovering(false);
                setHoverText('');
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseover', handleMouseOver);

        return () => {
            document.body.style.cursor = 'auto';
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseover', handleMouseOver);
        };
    }, [mouseX, mouseY]);

    return (
        <>
            {/* Small Leading Dot */}
            <motion.div
                className="fixed top-0 left-0 w-2 h-2 bg-white rounded-full pointer-events-none z-[100] mix-blend-difference"
                style={{
                    x: smoothX,
                    y: smoothY,
                    translateX: '-50%',
                    translateY: '-50%',
                }}
                animate={{
                    scale: isHovering ? 0 : 1,
                    opacity: isHovering ? 0 : 1,
                }}
                transition={{ duration: 0.2 }}
            />

            {/* Outer Ring / Interaction Bubble */}
            <motion.div
                className="fixed top-0 left-0 flex items-center justify-center rounded-full pointer-events-none z-[99] border border-white/40 overflow-hidden mix-blend-difference bg-transparent backdrop-blur-[2px]"
                style={{
                    x: smoothRingX,
                    y: smoothRingY,
                    translateX: '-50%',
                    translateY: '-50%',
                    width: isHovering ? (hoverText ? 80 : 50) : 32,
                    height: isHovering ? (hoverText ? 80 : 50) : 32,
                    backgroundColor: isHovering ? 'rgba(255, 255, 255, 1)' : 'transparent',
                    color: 'black',
                }}
                animate={{
                    scale: isHovering ? 1.2 : 1,
                }}
                transition={{
                    type: "spring",
                    stiffness: 150,
                    damping: 15,
                    mass: 0.5
                }}
            >
                {isHovering && hoverText && (
                    <motion.span
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        className="text-[10px] font-bold tracking-widest uppercase flex text-center leading-none"
                    >
                        {hoverText}
                    </motion.span>
                )}
            </motion.div>
        </>
    );
}

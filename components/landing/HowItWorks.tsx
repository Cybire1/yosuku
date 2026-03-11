'use client';

import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

if (typeof window !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
}

export default function HowItWorks() {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const text1Ref = useRef<HTMLDivElement>(null);
    const text2Ref = useRef<HTMLDivElement>(null);
    const text3Ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Resize handler
        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        // Generate 3D sphere points
        const points: { x: number, y: number, z: number, origX: number, origY: number, origZ: number }[] = [];
        const numPoints = 250;

        for (let i = 0; i < numPoints; i++) {
            const phi = Math.acos(-1 + (2 * i) / numPoints);
            const theta = Math.sqrt(numPoints * Math.PI) * phi;
            points.push({
                origX: Math.cos(theta) * Math.sin(phi),
                origY: Math.sin(theta) * Math.sin(phi),
                origZ: Math.cos(phi),
                x: 0, y: 0, z: 0
            });
        }

        const draw = (progress: number) => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;

            // Rotation angles based on scroll progress
            const rotY = progress * Math.PI * 4;
            const rotX = progress * Math.PI * 2;

            // Radius expands as you scroll deeper
            const radius = 250 + (progress * 500);

            // We'll store projected 2D coordinates to draw lines
            const projected: { x: number, y: number, z: number }[] = [];

            points.forEach(p => {
                const nx = p.origX * Math.cos(rotY) - p.origZ * Math.sin(rotY);
                let nz = p.origZ * Math.cos(rotY) + p.origX * Math.sin(rotY);
                const ny = p.origY * Math.cos(rotX) - nz * Math.sin(rotX);
                nz = nz * Math.cos(rotX) + p.origY * Math.sin(rotX);

                // Project 3D -> 2D
                const fov = 600;
                const scale = fov / (fov + nz * radius);
                const x2d = cx + nx * radius * scale;
                const y2d = cy + ny * radius * scale;

                projected.push({ x: x2d, y: y2d, z: nz });

                if (scale <= 0) return; // behind camera

                const alpha = Math.max(0.1, Math.min(1, scale - 0.2));

                // Start from a darker green instead of the original blue-led tone.
                const r = Math.floor(46 + progress * 198);
                const g = Math.floor(94 + progress * -31);
                const b = Math.floor(74 + progress * 20);

                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                ctx.beginPath();
                ctx.arc(x2d, y2d, 2 * scale, 0, Math.PI * 2);
                ctx.fill();
            });

            // Draw faint connections
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.04 + (progress * 0.08)})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            for (let i = 0; i < projected.length; i++) {
                for (let j = i + 1; j < projected.length; j++) {
                    const dx = projected[i].x - projected[j].x;
                    const dy = projected[i].y - projected[j].y;
                    const dist = dx * dx + dy * dy;
                    if (dist < 5000 * (1 + progress)) { // connect nearby dots
                        ctx.moveTo(projected[i].x, projected[i].y);
                        ctx.lineTo(projected[j].x, projected[j].y);
                    }
                }
            }
            ctx.stroke();

            // Handle Text Opacity Fades based on progress
            if (text1Ref.current && text2Ref.current && text3Ref.current) {
                // Phase 1: 0 to 0.33
                if (progress < 0.3) {
                    text1Ref.current.style.opacity = `${1 - (progress * 3.33)}`;
                    text1Ref.current.style.transform = `translateY(${progress * 50}px)`;
                    text2Ref.current.style.opacity = '0';
                    text3Ref.current.style.opacity = '0';
                }
                // Phase 2: 0.33 to 0.66
                else if (progress >= 0.3 && progress < 0.6) {
                    const localProg = (progress - 0.3) * 3.33;
                    text1Ref.current.style.opacity = '0';
                    text2Ref.current.style.opacity = localProg < 0.5 ? `${localProg * 2}` : `${2 - (localProg * 2)}`;
                    text2Ref.current.style.transform = `translateY(${(1 - localProg) * 20}px)`;
                    text3Ref.current.style.opacity = '0';
                }
                // Phase 3: 0.66 to 1.0
                else {
                    const localProg = (progress - 0.6) * 2.5; // (1 / 0.4)
                    text1Ref.current.style.opacity = '0';
                    text2Ref.current.style.opacity = '0';
                    text3Ref.current.style.opacity = `${localProg}`;
                    text3Ref.current.style.transform = `translateY(${(1 - localProg) * 20}px)`;
                }
            }
        };

        // Initial render
        draw(0);

        // Setup GSAP ScrollTrigger
        const st = ScrollTrigger.create({
            trigger: containerRef.current,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 1.5, // 1.5s smoothing 
            onUpdate: (self) => draw(self.progress)
        });

        return () => {
            window.removeEventListener('resize', resize);
            st.kill();
        };
    }, []);

    return (
        <section ref={containerRef} className="relative h-[400vh] w-full bg-[var(--background)]" data-cursor-text="Scroll">
            <div className="sticky top-0 h-screen w-full flex items-center justify-center overflow-hidden">

                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 pointer-events-none"
                />

                {/* Floating Text overlay 1: The Math of Trust */}
                <div ref={text1Ref} className="absolute inset-0 z-10 flex flex-col items-center justify-center max-w-4xl mx-auto px-4 text-center pointer-events-none mix-blend-difference will-change-transform">
                    <h2 className="text-5xl md:text-7xl lg:text-8xl font-black text-white mb-6 tracking-tighter">
                        The Math of Trust.
                    </h2>
                    <p className="text-xl text-white/80 max-w-2xl mx-auto font-light leading-relaxed">
                        Scroll to uncover how zero-knowledge proofs mathematically guarantee your privacy while smart contracts resolve markets instantly.
                    </p>
                </div>

                {/* Floating Text overlay 2: Zero-Knowledge */}
                <div ref={text2Ref} className="absolute inset-0 z-10 flex flex-col items-center justify-center max-w-4xl mx-auto px-4 text-center pointer-events-none mix-blend-difference opacity-0 will-change-transform">
                    <h2 className="text-5xl md:text-7xl lg:text-8xl font-black text-white mb-6 tracking-tighter text-[#34D399]">
                        Zero-Knowledge.
                    </h2>
                    <p className="text-xl text-white/80 max-w-2xl mx-auto font-light leading-relaxed">
                        Execute massive volume and complex prediction logic off-chain. Only the cryptographic proof is submitted to the Aleo network. No one sees your positions but you.
                    </p>
                </div>

                {/* Floating Text overlay 3: Finality */}
                <div ref={text3Ref} className="absolute inset-0 z-10 flex flex-col items-center justify-center max-w-4xl mx-auto px-4 text-center pointer-events-none mix-blend-difference opacity-0 will-change-transform">
                    <h2 className="text-5xl md:text-7xl lg:text-8xl font-black text-white mb-6 tracking-tighter text-[#F43F5E]">
                        Instant Finality.
                    </h2>
                    <p className="text-xl text-white/80 max-w-2xl mx-auto font-light leading-relaxed">
                        Mathematical certainty meets split-second execution. When the countdown hits zero, the network executes the trustless payout immediately.
                    </p>
                </div>

            </div>
        </section>
    );
}

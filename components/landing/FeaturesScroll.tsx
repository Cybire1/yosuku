'use client';

import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import TiltCard from './TiltCard';

if (typeof window !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
}

export default function FeaturesScroll() {
    const sectionRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const section = sectionRef.current;
        const track = trackRef.current;
        if (!section || !track) return;

        // Calculate how far we need to translate horizontally
        const getScrollAmount = () => {
            let trackWidth = track.scrollWidth;
            return -(trackWidth - window.innerWidth);
        };

        const ctx = gsap.context(() => {
            // Pin the section and horizontally translate the track
            gsap.to(track, {
                x: getScrollAmount,
                ease: "none",
                scrollTrigger: {
                    trigger: section,
                    start: "top top",
                    end: () => `+=${getScrollAmount() * -1}`,
                    pin: true,
                    scrub: 1, // Add 1s smoothing
                    invalidateOnRefresh: true
                }
            });

            // Initialize Canvas Particle Wave for Slide 2
            const canvas = canvasRef.current;
            let renderFrame: number;
            if (canvas) {
                const c = canvas.getContext('2d');
                if (c) {
                    const resize = () => {
                        const parent = canvas.parentElement;
                        if (parent) {
                            // Double resolution for retina displays
                            const dpr = window.devicePixelRatio || 1;
                            canvas.width = parent.clientWidth * dpr;
                            canvas.height = parent.clientHeight * dpr;
                            c.scale(dpr, dpr);
                            canvas.style.width = `${parent.clientWidth}px`;
                            canvas.style.height = `${parent.clientHeight}px`;
                        }
                    };
                    resize();
                    window.addEventListener('resize', resize);

                    // Generate some particles
                    const particles: { x: number, y: number, offset: number, radius: number }[] = [];
                    const numParticles = 250;
                    for (let i = 0; i < numParticles; i++) {
                        particles.push({
                            x: (i / numParticles), // Normalized x position (0 to 1)
                            y: 0,
                            offset: i * 0.1,
                            radius: Math.random() * 2 + 1
                        });
                    }

                    // Render loop
                    let time = 0;
                    const render = () => {
                        time += 0.03;
                        c.clearRect(0, 0, canvas.width, canvas.height);

                        // Use logical width/height since we scaled the context
                        const logicalWidth = canvas.width / (window.devicePixelRatio || 1);
                        const logicalHeight = canvas.height / (window.devicePixelRatio || 1);

                        c.fillStyle = 'rgba(52, 211, 153, 0.8)'; // Mint Green

                        particles.forEach((p) => {
                            const x = p.x * logicalWidth;
                            // Create a complex wave pattern
                            const wave1 = Math.sin(time + p.offset) * 80;
                            const wave2 = Math.cos(time * 0.5 + p.offset * 0.5) * 40;
                            const y = logicalHeight / 2 + wave1 + wave2;

                            c.beginPath();
                            c.arc(x, y, p.radius, 0, Math.PI * 2);
                            c.fill();
                        });

                        // Draw connecting lines between close particles
                        c.strokeStyle = 'rgba(52, 211, 153, 0.15)';
                        c.lineWidth = 1;
                        c.beginPath();
                        for (let i = 0; i < particles.length - 1; i++) {
                            const x1 = particles[i].x * logicalWidth;
                            const y1 = logicalHeight / 2 + Math.sin(time + particles[i].offset) * 80 + Math.cos(time * 0.5 + particles[i].offset * 0.5) * 40;
                            const x2 = particles[i + 1].x * logicalWidth;
                            const y2 = logicalHeight / 2 + Math.sin(time + particles[i + 1].offset) * 80 + Math.cos(time * 0.5 + particles[i + 1].offset * 0.5) * 40;
                            c.moveTo(x1, y1);
                            c.lineTo(x2, y2);
                        }
                        c.stroke();

                        renderFrame = requestAnimationFrame(render);
                    };
                    render();

                    return () => {
                        window.removeEventListener('resize', resize);
                        cancelAnimationFrame(renderFrame);
                    };
                }
            }
        });

        return () => ctx.revert();
    }, []);

    return (
        <section ref={sectionRef} className="relative h-screen bg-zinc-900 border-t border-white/5 overflow-hidden">
            <div
                ref={trackRef}
                className="flex h-full w-[300vw] will-change-transform"
            >
                {/* --- SLIDE 1: Brutalist Typography --- */}
                <div className="w-screen h-full flex items-center justify-center relative flex-shrink-0">
                    {/* Massive masked text */}
                    <div className="overflow-hidden mix-blend-difference z-10 w-full flex flex-col items-center">
                        <h2 className="text-[18vw] font-black uppercase text-white leading-[0.85] tracking-tighter text-center">
                            THE CORE
                        </h2>
                        <h2 className="text-[18vw] font-black uppercase text-white leading-[0.85] tracking-tighter text-center">
                            PROTOCOL
                        </h2>
                    </div>
                    {/* Geometric underlying element */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[35vw] h-[35vw] bg-white rounded-full mix-blend-screen opacity-10 blur-xl" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[20vw] h-[20vw] border-[1px] border-white/20 rounded-full" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[22vw] h-[22vw] border-[1px] border-white/10 rounded-full" />
                </div>

                {/* --- SLIDE 2: Canvas Wave & Deep Liquidity --- */}
                <div className="w-screen h-full flex flex-col items-center justify-center relative flex-shrink-0 bg-zinc-950">
                    {/* Canvas layer */}
                    <div className="absolute inset-0 z-0">
                        <canvas ref={canvasRef} className="w-full h-full" />
                    </div>
                    {/* Content layer */}
                    <div className="relative z-10 text-center pointer-events-none mt-20">
                        <h3 className="text-6xl md:text-[8vw] font-black text-white mb-6 tracking-tighter mix-blend-difference">DEEP LIQUIDITY</h3>
                        <p className="text-xl md:text-2xl font-light text-zinc-400 max-w-2xl mx-auto mix-blend-difference">
                            Mathematical precision flowing dynamically across global zero-knowledge prediction pools.
                        </p>
                    </div>
                </div>

                {/* --- SLIDE 3: Glass Cards / Global Access --- */}
                <div className="w-screen h-full flex items-center justify-center flex-shrink-0 bg-[#030303] relative border-l border-white/5">
                    <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none mix-blend-overlay" />

                    <div className="w-full max-w-7xl mx-auto px-12 z-10 flex flex-col md:flex-row items-center justify-between gap-16">
                        <div className="flex-1">
                            <h3 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tighter">Global Access</h3>
                            <p className="text-xl text-zinc-400 font-light">
                                Unrestricted prediction markets. Scale seamlessly across multiple chains while maintaining absolute cryptographic privacy.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 flex-1">
                            {[
                                { title: "ZkSNARKs", value: "Verified", color: "bg-[#34D399]" },
                                { title: "Latency", value: "Sub-second", color: "bg-[#60A5FA]" },
                                { title: "Uptime", value: "99.99%", color: "bg-[#F43F5E]" },
                                { title: "Privacy", value: "Absolute", color: "bg-white" }
                            ].map((item, idx) => (
                                <TiltCard
                                    key={idx}
                                    className="p-8 rounded-3xl bg-white/[0.03] backdrop-blur-2xl border border-white/10 hover:border-white/20 transition-all duration-300 group cursor-pointer"
                                    data-cursor-text="Inspect"
                                >
                                    <div className={`w-3 h-3 rounded-full mb-8 ${item.color} shadow-[0_0_15px_inherit]`} />
                                    <p className="text-sm text-zinc-500 uppercase tracking-widest mb-1">{item.title}</p>
                                    <h4 className="text-2xl font-semibold text-white">{item.value}</h4>
                                </TiltCard>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

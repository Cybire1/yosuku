'use client';

import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import TiltCard from './TiltCard';

if (typeof window !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
}

const FEATURE_ITEMS = [
    { title: 'ZkSNARKs', value: 'Verified', color: 'bg-[#34D399]' },
    { title: 'Latency', value: 'Sub-second', color: 'bg-[#60A5FA]' },
    { title: 'Uptime', value: '99.99%', color: 'bg-[#F43F5E]' },
    { title: 'Privacy', value: 'Absolute', color: 'bg-white' }
];

export default function FeaturesScroll() {
    const sectionRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (window.innerWidth < 768) return;

        const section = sectionRef.current;
        const track = trackRef.current;
        if (!section || !track) return;

        // Calculate how far we need to translate horizontally
        const getScrollAmount = () => {
            const trackWidth = track.scrollWidth;
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
        <>
        <section className="border-t border-white/5 bg-[var(--background)] px-4 py-5 md:hidden">
            <div className="space-y-4">
                <div className="relative overflow-hidden rounded-[2rem] bg-[#6fcc9c] px-4 py-14">
                    <div
                        className="absolute inset-0"
                        style={{
                            background:
                                'radial-gradient(circle at 50% 42%, rgba(255,255,255,0.26), transparent 22%), linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 24%)',
                        }}
                    />
                    <div className="relative z-10">
                        <div className="mb-10 text-center">
                            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-[#0b1311]/55">
                                Core Layer
                            </p>
                        </div>
                        <div className="flex flex-col items-center">
                            <h2 className="text-center text-[20vw] font-black uppercase leading-[0.84] tracking-[-0.06em] text-[#0b1311]">
                                THE CORE
                            </h2>
                            <h2 className="text-center text-[20vw] font-black uppercase leading-[0.84] tracking-[-0.06em] text-[#0b1311]">
                                PROTOCOL
                            </h2>
                        </div>
                    </div>
                    <div className="absolute left-1/2 top-1/2 h-[56vw] w-[56vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/14 blur-xl" />
                    <div className="absolute left-1/2 top-1/2 h-[36vw] w-[36vw] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#0b1311]/12" />
                </div>

                <div className="relative overflow-hidden rounded-[2rem] border border-white/8 bg-[var(--surface-100)] px-5 py-10">
                    <div
                        className="absolute inset-0 opacity-70"
                        style={{
                            background:
                                'radial-gradient(circle at 50% 20%, rgba(255,255,255,0.08), transparent 24%), linear-gradient(180deg, rgba(52,211,153,0.08) 0%, rgba(52,211,153,0) 55%)',
                        }}
                    />
                    <div className="absolute inset-x-0 bottom-0 h-40 opacity-60">
                        <div
                            className="h-full w-full"
                            style={{
                                backgroundImage:
                                    'radial-gradient(circle at 0% 58%, rgba(111,204,156,0.9) 0 3px, transparent 4px), radial-gradient(circle at 16% 36%, rgba(111,204,156,0.82) 0 3px, transparent 4px), radial-gradient(circle at 32% 62%, rgba(111,204,156,0.84) 0 3px, transparent 4px), radial-gradient(circle at 48% 40%, rgba(111,204,156,0.86) 0 3px, transparent 4px), radial-gradient(circle at 64% 66%, rgba(111,204,156,0.82) 0 3px, transparent 4px), radial-gradient(circle at 80% 34%, rgba(111,204,156,0.88) 0 3px, transparent 4px), radial-gradient(circle at 100% 60%, rgba(111,204,156,0.9) 0 3px, transparent 4px)',
                                backgroundRepeat: 'no-repeat',
                            }}
                        />
                    </div>
                    <div className="relative z-10 text-center">
                        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/36">
                            Liquidity Layer
                        </p>
                        <h3 className="mt-3 text-[3.1rem] font-black leading-[0.88] tracking-[-0.06em] text-white">
                            DEEP
                            <span className="block">LIQUIDITY</span>
                        </h3>
                        <p className="mx-auto mt-4 max-w-[17rem] text-[15px] leading-7 text-white/62">
                            Mathematical precision flowing dynamically across global zero-knowledge prediction pools.
                        </p>
                    </div>
                </div>

                <div className="relative overflow-hidden rounded-[2rem] border border-white/8 bg-[var(--surface-200)] px-5 py-10">
                    <div className="max-w-[19rem]">
                        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-white/36">
                            Access Layer
                        </p>
                        <h3 className="mt-3 text-[2.55rem] font-black leading-[0.92] tracking-[-0.05em] text-white">
                            Global Access
                        </h3>
                        <p className="mt-4 text-[15px] leading-7 text-white/62">
                            Unrestricted prediction markets that scale across chains while maintaining cryptographic privacy.
                        </p>
                    </div>

                    <div className="mt-8 grid grid-cols-2 gap-3">
                        {FEATURE_ITEMS.map((item) => (
                            <div
                                key={item.title}
                                className="rounded-[1.6rem] border border-white/8 bg-white/[0.03] p-5 backdrop-blur-xl"
                            >
                                <div className={`mb-7 h-3 w-3 rounded-full ${item.color}`} />
                                <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-white/30">{item.title}</p>
                                <h4 className="text-[1.7rem] font-semibold leading-none text-white">{item.value}</h4>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>

        <section ref={sectionRef} className="relative hidden h-screen overflow-hidden border-t border-white/5 bg-[var(--background)] md:block">
            <div
                ref={trackRef}
                className="flex h-full w-[300vw] will-change-transform"
            >
                {/* --- SLIDE 1: Brutalist Typography --- */}
                <div className="relative flex h-full w-screen flex-shrink-0 items-center justify-center overflow-hidden bg-[#6fcc9c]">
                    <div
                        className="absolute inset-0"
                        style={{
                            background:
                                'radial-gradient(circle at 50% 48%, rgba(255,255,255,0.26), transparent 18%), linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 24%), linear-gradient(90deg, rgba(9,16,14,0.08) 0%, rgba(9,16,14,0) 18%, rgba(9,16,14,0) 82%, rgba(9,16,14,0.08) 100%)',
                        }}
                    />
                    <div
                        className="absolute inset-0 opacity-[0.08]"
                        style={{
                            backgroundImage:
                                'linear-gradient(rgba(12,18,16,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(12,18,16,0.08) 1px, transparent 1px)',
                            backgroundSize: '72px 72px',
                        }}
                    />
                    {/* Massive masked text */}
                    <div className="z-10 flex w-full flex-col items-center overflow-hidden">
                        <h2 className="text-center text-[18vw] font-black uppercase leading-[0.85] tracking-tighter text-[#0b1311]">
                            THE CORE
                        </h2>
                        <h2 className="text-center text-[18vw] font-black uppercase leading-[0.85] tracking-tighter text-[#0b1311]">
                            PROTOCOL
                        </h2>
                    </div>
                    {/* Geometric underlying element */}
                    <div className="absolute left-1/2 top-1/2 h-[35vw] w-[35vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/18 opacity-60 blur-xl" />
                    <div className="absolute left-1/2 top-1/2 h-[20vw] w-[20vw] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1px] border-[#0b1311]/16" />
                    <div className="absolute left-1/2 top-1/2 h-[22vw] w-[22vw] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1px] border-[#0b1311]/10" />
                </div>

                {/* --- SLIDE 2: Canvas Wave & Deep Liquidity --- */}
                <div className="relative flex h-full w-screen flex-shrink-0 flex-col items-center justify-center bg-[var(--surface-100)]">
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
                <div className="relative flex h-full w-screen flex-shrink-0 items-center justify-center border-l border-white/5 bg-[var(--surface-200)]">
                    <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none mix-blend-overlay" />

                    <div className="w-full max-w-7xl mx-auto px-12 z-10 flex flex-col md:flex-row items-center justify-between gap-16">
                        <div className="flex-1">
                            <h3 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tighter">Global Access</h3>
                            <p className="text-xl text-zinc-400 font-light">
                                Unrestricted prediction markets. Scale seamlessly across multiple chains while maintaining absolute cryptographic privacy.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 flex-1">
                            {FEATURE_ITEMS.map((item, idx) => (
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
        </>
    );
}

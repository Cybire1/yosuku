'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { ArrowRight, Clock, Shield, CheckCircle } from 'lucide-react';
import MagneticButton from './MagneticButton';

// High-performance Particle System for the Canvas Background inside the Portal
class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;

  constructor(width: number, height: number) {
    this.x = Math.random() * width;
    this.y = Math.random() * height;
    this.vx = (Math.random() - 0.5) * 0.4;
    this.vy = (Math.random() - 0.5) * 0.4;
    this.radius = Math.random() * 1.5 + 0.5;
  }

  update(width: number, height: number) {
    this.x += this.vx;
    this.y += this.vy;

    if (this.x < 0 || this.x > width) this.vx *= -1;
    if (this.y < 0 || this.y > height) this.vy *= -1;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fill();
  }
}

function ParticleNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let particles: Particle[] = [];
    let animationFrameId: number;
    let width = canvas.clientWidth;  // Use clientWidth instead of window.innerWidth for bounded container
    let height = canvas.clientHeight;

    const init = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width;
      canvas.height = height;

      // Responsive particle count based on container area
      const particleCount = Math.min(Math.floor((width * height) / 15000), 80);
      particles = [];
      for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle(width, height));
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw faint connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 * (1 - dist / 150)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Update and draw particles
      particles.forEach((p) => {
        p.update(width, height);
        p.draw(ctx);
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    init();
    animate();

    const handleResize = () => {
      init();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-0 mix-blend-screen opacity-70"
    />
  );
}

export default function HeroSection() {
  const router = useRouter();
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };

  const bentoClasses = "relative overflow-hidden bg-zinc-950/50 border border-white/10 rounded-[2rem] backdrop-blur-md flex flex-col";
  const whiteBentoClasses = "relative overflow-hidden bg-white border border-black/5 rounded-[2rem] shadow-xl flex flex-col";

  return (
    <section className="relative w-full min-h-screen bg-[#030303] text-white p-4 sm:p-6 lg:p-8 flex items-center justify-center pt-24 sm:pt-28">

      {/* Full Bento Grid */}
      <div className="w-full max-w-[1800px] lg:h-[85vh] lg:min-h-[700px] grid grid-cols-1 lg:grid-cols-4 lg:grid-rows-3 gap-3 sm:gap-4 lg:gap-6 z-10 relative">

        {/* Left Column - Top (Briefing) - WHITE THEME */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.1 }}
          className={`${whiteBentoClasses} lg:col-span-1 lg:row-span-2 p-6 sm:p-8 justify-between`}
        >
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 rounded-full border border-black/5 bg-zinc-100">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
              <span className="text-[10px] font-semibold tracking-widest uppercase text-zinc-500">Private by Default</span>
            </div>
            <h1 className="text-2xl sm:text-3xl xl:text-4xl font-light tracking-tight text-zinc-900 mb-4 sm:mb-6 leading-[1.1]">
              The world's first <br /><span className="font-medium italic text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-emerald-300">private 5-minute</span> prediction markets
            </h1>
            <p className="text-zinc-600 text-sm xl:text-base font-light leading-relaxed">
              Your bets are encrypted. Your identity is hidden. Only you know your positions.
              Built on Aleo with zero-knowledge proofs.
            </p>
          </div>

          {/* Decorative Technical Hatching */}
          <div className="absolute top-0 right-0 w-32 h-32 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #000000 0, #000000 1px, transparent 1px, transparent 8px)' }}></div>
        </motion.div>

        {/* Left Column - Bottom (CTAs) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className={`${bentoClasses} lg:col-span-1 lg:row-span-1 p-6 justify-end bg-gradient-to-br from-zinc-950/80 to-zinc-900/80`}
        >
          <div className="flex flex-col gap-4 w-full">
            <MagneticButton>
              <button
                onClick={() => router.push('/markets')}
                className="relative w-full overflow-hidden flex items-center justify-between px-6 py-4 rounded-2xl bg-emerald-400 hover:bg-emerald-300 text-zinc-950 font-bold transition-all shadow-[0_0_20px_rgba(52,211,153,0.3)] hover:shadow-[0_0_30px_rgba(52,211,153,0.5)] group"
              >
                <span className="tracking-wide">Start Predicting</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </MagneticButton>

            <MagneticButton>
              <button className="w-full flex items-center justify-between px-6 py-4 rounded-2xl border border-white/10 text-white hover:bg-white/5 transition-colors group">
                <span className="font-medium">Read Documentation</span>
                <ArrowRight className="w-5 h-5 text-zinc-500 group-hover:translate-x-1 group-hover:text-white transition-all" />
              </button>
            </MagneticButton>
          </div>
        </motion.div>

        {/* Center - The Portal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.3 }}
          className={`${bentoClasses} lg:col-span-2 lg:row-span-3 overflow-hidden relative group min-h-[280px] sm:min-h-[350px]`}
        >
          {/* Subtle Portal Radial Glow */}
          <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent z-10 pointer-events-none" />

          {/* The Network Particles inside the portal */}
          <div className="absolute inset-0 z-0">
            <ParticleNetwork />
          </div>

          {/* Centerpiece Portal Image Overlay */}
          <div className="absolute inset-x-0 bottom-0 top-[15%] flex flex-col items-center justify-center pointer-events-none blur-[0.5px]">
            <img
              src="/bento-portal.png"
              className="w-full h-full object-cover mix-blend-lighten opacity-[0.85] rounded-full drop-shadow-[0_0_80px_rgba(52,211,153,0.2)] lg:-translate-y-8 lg:w-[110%] lg:h-[110%]"
              alt="Web3 Portal"
            />
          </div>

          <div className="absolute bottom-6 left-6 z-20">
            <p className="text-xs font-mono text-zinc-500 tracking-wider">SYSTEM / CORE_PORTAL</p>
          </div>
        </motion.div>

        {/* Right Column - Top (Telemetry Clock) - WHITE THEME */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className={`${whiteBentoClasses} lg:col-span-1 lg:row-span-1 p-6 sm:p-8 flex-col justify-center`}
        >
          <Clock className="w-5 h-5 text-zinc-400 mb-4" />
          <p className="text-2xl sm:text-3xl xl:text-4xl font-light tracking-tight text-zinc-900 mb-2">
            {time ? formatTime(time) : '00:00 AM'}
          </p>
          <p className="text-zinc-500 text-sm font-medium">
            {time ? formatDate(time) : 'Loading...'}
          </p>
        </motion.div>

        {/* Right Column - Middle (Zero-Knowledge Privacy) */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className={`${bentoClasses} lg:col-span-1 lg:row-span-1 p-6 sm:p-8 flex-col justify-center`}
        >
          <Shield className="w-5 h-5 text-sky-400 mb-4" />
          <p className="text-xl tracking-tight text-white mb-3">Zero-Knowledge Privacy</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-sm text-zinc-400">Encrypted Bets</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-sm text-zinc-400">Hidden Addresses</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-sm text-zinc-400">Private Records</span>
            </div>
          </div>
        </motion.div>

        {/* Right Column - Bottom (Scroll Indicator) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className={`${bentoClasses} lg:col-span-1 lg:row-span-1 p-6 sm:p-8 flex-row items-end justify-between hover:bg-zinc-900/80 transition-colors group cursor-pointer`}
          onClick={() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}
        >
          <div className="flex flex-col">
            <p className="text-sm font-semibold text-white tracking-widest uppercase">Scroll</p>
            <p className="text-xs text-zinc-400 tracking-wider">to explore page</p>
          </div>

          {/* Animated Arrow / Line (Highly Visible) */}
          <div className="relative w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center overflow-hidden border-2 border-white/20 rounded-full bg-white/5 group-hover:bg-white/10 transition-colors">
            <motion.div
              animate={{ y: [-30, 30] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              className="w-1 h-8 bg-emerald-400 rounded-full absolute shadow-[0_0_10px_rgba(52,211,153,0.8)]"
            />
          </div>
        </motion.div>

      </div>
    </section>
  );
}

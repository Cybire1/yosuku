'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import MagneticButton from './MagneticButton';
import TickerMarquee from './TickerMarquee';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

/* ─── Live BTC Price Badge ─── */
function BtcBadge() {
  const { price, change24h } = useBtcPrice();
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevPrice = useRef(price);

  useEffect(() => {
    if (price === 0 || prevPrice.current === 0) {
      prevPrice.current = price;
      return;
    }
    if (price > prevPrice.current) setFlash('up');
    else if (price < prevPrice.current) setFlash('down');
    prevPrice.current = price;
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [price]);

  if (price === 0) return null;

  return (
    <div
      className={`
        btc-badge inline-flex items-center gap-2 px-4 py-2 rounded-full
        border backdrop-blur-md font-mono text-sm transition-colors duration-300
        ${flash === 'up' ? 'border-[#34D399] bg-[#34D399]/10' : ''}
        ${flash === 'down' ? 'border-[#F43F5E] bg-[#F43F5E]/10' : ''}
        ${flash === null ? 'border-zinc-700 bg-zinc-900/60' : ''}
      `}
    >
      <span className="text-zinc-400 text-xs font-medium">BTC</span>
      <span className="text-white font-semibold">
        ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span className={`text-xs ${change24h >= 0 ? 'text-[#34D399]' : 'text-[#F43F5E]'}`}>
        {change24h >= 0 ? '▲' : '▼'}{Math.abs(change24h).toFixed(1)}%
      </span>
    </div>
  );
}

/* ─── Canvas Dot Grid Background ─── */
function DotGrid({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: 0, y: 0 });
  const animRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const spacing = 40;
    const cols = Math.ceil(w / spacing) + 1;
    const rows = Math.ceil(h / spacing) + 1;
    const time = Date.now() * 0.001;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * spacing;
        const y = r * spacing;

        // Distance from mouse for subtle interaction
        const dx = (x - mouse.current.x) / w;
        const dy = (y - mouse.current.y) / h;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Breathing pulse + mouse proximity
        const pulse = 0.3 + 0.15 * Math.sin(time * 1.5 + c * 0.2 + r * 0.3);
        const proximity = Math.max(0, 1 - dist * 3) * 0.3;
        const alpha = Math.min(pulse + proximity, 0.6);
        const radius = (1 + proximity * 2) * dpr;

        ctx.beginPath();
        ctx.arc(x * dpr, y * dpr, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fill();
      }
    }

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = container.clientWidth + 'px';
      canvas.style.height = container.clientHeight + 'px';
    };

    const handleMouse = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.current.x = e.clientX - rect.left;
      mouse.current.y = e.clientY - rect.top;
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMouse);
    animRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouse);
      cancelAnimationFrame(animRef.current);
    };
  }, [containerRef, draw]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none hidden md:block"
      style={{ opacity: 0.4 }}
    />
  );
}

/* ─── Main Hero Section ─── */
export default function HeroSection() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: container,
          start: 'top top',
          end: '+=300%',
          pin: true,
          scrub: 1,
          anticipatePin: 1,
        },
      });

      // Phase 1 (0-20%): "PREDICT" slides from left
      tl.fromTo(
        '.hero-line-1',
        { xPercent: -110, opacity: 0 },
        { xPercent: 0, opacity: 1, duration: 1, ease: 'power3.out' }
      );

      // Phase 2 (20-40%): Green accent block + "THE FUTURE" from right
      tl.fromTo(
        '.hero-accent-block',
        { scaleX: 0, opacity: 0 },
        { scaleX: 1, opacity: 1, duration: 0.6, ease: 'power3.out' },
        '+=0.2'
      );
      tl.fromTo(
        '.hero-line-2',
        { xPercent: 110, opacity: 0 },
        { xPercent: 0, opacity: 1, duration: 1, ease: 'power3.out' },
        '<+=0.1'
      );

      // Phase 3 (40-60%): "ON ALEO" from left + BTC badge fades in
      tl.fromTo(
        '.hero-line-3',
        { xPercent: -110, opacity: 0 },
        { xPercent: 0, opacity: 1, duration: 1, ease: 'power3.out' },
        '+=0.2'
      );
      tl.fromTo(
        '.btc-badge',
        { opacity: 0, y: -20 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' },
        '<+=0.3'
      );

      // Phase 4 (60-80%): Subtext + CTA buttons
      tl.fromTo(
        '.hero-subtext',
        { opacity: 0, y: 40 },
        { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' },
        '+=0.3'
      );
      tl.fromTo(
        '.hero-cta',
        { opacity: 0, y: 30 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' },
        '<+=0.2'
      );

      // Phase 5 (80-100%): Ticker slides in from bottom
      tl.fromTo(
        '.hero-ticker',
        { yPercent: 100, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 0.8, ease: 'power2.out' },
        '+=0.2'
      );
    }, container);

    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-screen bg-zinc-900 flex flex-col justify-between overflow-hidden text-white"
    >
      {/* Canvas dot grid background */}
      <DotGrid containerRef={containerRef} />

      {/* Live BTC Badge — top right */}
      <div className="absolute top-6 right-6 md:top-8 md:right-10 z-20">
        <BtcBadge />
      </div>

      {/* ── Main Typography ── */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 md:px-[50px] relative z-10">

        {/* Line 1: PREDICT */}
        <div className="overflow-hidden">
          <div className="hero-line-1 opacity-0">
            <h1 className="font-extrabold uppercase text-[16vw] md:text-[13vw] leading-none tracking-tight">
              PREDICT
            </h1>
          </div>
        </div>

        {/* Line 2: Green block + THE FUTURE */}
        <div className="overflow-hidden flex items-center">
          <div
            className="hero-accent-block origin-left h-[8vw] md:h-[7vw] lg:h-[6vw] w-[9vw] rounded-md md:rounded-xl bg-[#34D399] flex-shrink-0 mr-[2vw] opacity-0"
          />
          <div className="hero-line-2 opacity-0">
            <h1 className="font-extrabold uppercase text-[16vw] md:text-[13vw] leading-none tracking-tight">
              THE FUTURE
            </h1>
          </div>
        </div>

        {/* Line 3: ON ALEO */}
        <div className="overflow-hidden">
          <div className="hero-line-3 opacity-0">
            <h1 className="font-extrabold uppercase text-[16vw] md:text-[13vw] leading-none tracking-tight text-[#60A5FA]">
              ON ALEO
            </h1>
          </div>
        </div>
      </div>

      {/* ── Footer: Subtext + CTA ── */}
      <div className="border-t border-zinc-700 flex flex-col md:flex-row justify-between items-start md:items-center py-5 px-6 sm:px-12 md:px-[50px] gap-6 md:gap-0 relative z-10">

        {/* Subtext */}
        <div className="hero-subtext opacity-0 flex flex-col md:flex-row gap-4 md:gap-20">
          <p className="text-sm md:text-base font-light tracking-tight text-zinc-300">
            Zero-knowledge privacy.
          </p>
          <p className="text-sm md:text-base font-light tracking-tight text-zinc-300">
            Trustless resolution.
          </p>
        </div>

        {/* CTA Buttons */}
        <div className="hero-cta opacity-0 flex items-center gap-3">
          <MagneticButton>
            <motion.button
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              onClick={() => router.push('/markets')}
              className="relative overflow-hidden px-6 py-2 border border-zinc-500 rounded-full font-light text-sm tracking-widest uppercase cursor-pointer transition-colors duration-300"
              animate={{
                backgroundColor: isHovered ? '#ffffff' : 'transparent',
                color: isHovered ? '#000000' : '#ffffff',
                borderColor: isHovered ? '#ffffff' : '#71717a',
              }}
            >
              <span className="relative z-10 font-medium">Launch App</span>
            </motion.button>
          </MagneticButton>

          <MagneticButton>
            <motion.div
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              onClick={() => router.push('/markets')}
              className="relative w-10 h-10 flex justify-center items-center rounded-full border border-zinc-500 cursor-pointer overflow-hidden transition-colors duration-300"
              animate={{
                backgroundColor: isHovered ? '#ffffff' : 'transparent',
                borderColor: isHovered ? '#ffffff' : '#71717a',
              }}
            >
              <ArrowUpRight
                className={`relative z-10 w-5 h-5 transition-colors duration-300 ${isHovered ? 'text-black' : 'text-white'}`}
              />
            </motion.div>
          </MagneticButton>
        </div>
      </div>

      {/* ── Ticker Marquee ── */}
      <div className="hero-ticker opacity-0 relative z-10">
        <TickerMarquee />
      </div>
    </div>
  );
}

'use client';

import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { WalletMultiButton } from '@demox-labs/aleo-wallet-adapter-reactui';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Target, Menu, X, ArrowUpRight } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV_LINKS = [
  { name: 'home', href: '/' },
  { name: 'markets', href: '/markets' },
  { name: 'portfolio', href: '/portfolio' },
  { name: 'leaderboard', href: '/leaderboard' },
  { name: 'create', href: '/create' },
];

export default function Header() {
  const { publicKey } = useWallet();
  const router = useRouter();
  const pathname = usePathname();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      <header className="fixed top-6 left-0 right-0 z-50 flex justify-center pointer-events-none select-none px-4">
        <motion.div
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="pointer-events-auto bg-black/60 backdrop-blur-2xl border border-white/5 rounded-full p-1.5 flex items-center justify-between shadow-2xl shadow-black/50 max-w-5xl w-full"
        >

          {/* Logo Section */}
          <div
            className="pl-4 md:pl-5 pr-2 md:pr-6 cursor-pointer group flex items-center gap-2"
            onClick={() => router.push('/')}
          >
            <div className="relative">
              <Target className="w-5 h-5 text-white group-hover:text-new-mint transition-colors duration-300" strokeWidth={2.5} />
              <div className="absolute inset-0 bg-new-mint/20 blur-lg rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
            <span className="font-bold tracking-tight text-white group-hover:text-white/90 transition-colors hidden sm:block">DART</span>
          </div>

          {/* Desktop Separator */}
          <div className="hidden md:block h-4 w-[1px] bg-white/10 mr-1" />

          {/* Desktop Navigation - Sliding Pill */}
          <nav className="hidden md:flex items-center">
            {NAV_LINKS.map((link, index) => {
              const isActive = pathname === link.href || (link.href !== '/' && pathname?.startsWith(link.href));

              return (
                <a
                  key={link.name}
                  href={link.href}
                  className="relative px-4 lg:px-5 py-2 text-sm font-medium transition-colors duration-300"
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  {/* Active/Hover Text Color Logic */}
                  <span className={`relative z-10 transition-colors duration-300 ${isActive ? 'text-white' : hoveredIndex === index ? 'text-white' : 'text-gray-400'
                    }`}>
                    {link.name}
                  </span>

                  {/* Sliding Glass Background with Glow */}
                  <AnimatePresence>
                    {hoveredIndex === index && (
                      <motion.div
                        layoutId="nav-pill"
                        className="absolute inset-0 bg-white/10 rounded-full"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                      >
                        <div className="absolute inset-0 bg-white/5 blur-sm rounded-full" />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Active Indicator Dot */}
                  {isActive && (
                    <motion.div
                      layoutId="active-dot"
                      className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-new-mint rounded-full shadow-[0_0_8px_2px_rgba(52,211,153,0.5)]"
                    />
                  )}
                </a>
              );
            })}
          </nav>

          {/* Mobile Spacer */}
          <div className="md:hidden flex-1" />

          {/* Desktop Separator */}
          <div className="hidden md:block h-4 w-[1px] bg-white/10 ml-1 mr-2" />

          {/* Wallet & Actions (Desktop & Mobile) */}
          <div className="flex items-center gap-2 pl-2 pr-1.5">
            {publicKey && (
              <button
                onClick={() => router.push('/create')}
                className="group relative flex items-center justify-center w-9 h-9 rounded-full bg-white/5 hover:bg-new-mint border border-white/10 hover:border-new-mint text-new-mint hover:text-black transition-all duration-300 backdrop-blur-md"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}

            <div className="transform transition-transform hover:scale-105 active:scale-95 hidden sm:block">
              <WalletMultiButton className="!bg-white/5 !backdrop-blur-md !text-white !border !border-white/10 !rounded-full !font-bold !h-9 !px-5 !text-xs hover:!bg-white hover:!text-black hover:!border-white hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] transition-all duration-300 uppercase tracking-wider" />
            </div>
            {/* Small Mobile Wallet Button (Icon Only if needed, or just keep MultiButton handled by library) */}
            <div className="sm:hidden transform scale-90">
              <WalletMultiButton style={{ padding: '0 12px', height: '32px', fontSize: '10px' }} />
            </div>

            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden w-8 h-8 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors ml-1"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>

        </motion.div>
      </header>

      {/* Mobile Menu Overlay - Award Winning Liquid Glass */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-[40px] md:hidden flex flex-col"
          >
            {/* Background Gradient Orbs */}
            <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-new-mint/20 blur-[120px] rounded-full pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-new-blue/20 blur-[120px] rounded-full pointer-events-none" />

            <div className="relative z-10 flex flex-col h-full p-8">
              {/* Header Row */}
              <div className="flex justify-between items-center mb-16">
                <div className="flex items-center gap-2 text-white">
                  <Target className="w-8 h-8 text-new-mint" />
                  <span className="font-black text-2xl tracking-tighter">DART</span>
                </div>
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="group p-3 rounded-full bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all hover:scale-110 active:scale-95"
                >
                  <X className="w-8 h-8 group-hover:rotate-90 transition-transform duration-300" />
                </button>
              </div>

              {/* Navigation Links - Staggered Reveal */}
              <nav className="flex flex-col gap-6 flex-1 justify-center">
                {NAV_LINKS.map((link, index) => (
                  <motion.a
                    key={link.name}
                    href={link.href}
                    initial={{ opacity: 0, x: -50 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -30 }}
                    transition={{
                      delay: index * 0.1,
                      type: "spring",
                      stiffness: 100,
                      damping: 20
                    }}
                    className="relative group flex items-center gap-6"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <span className="text-sm font-mono text-new-mint/40 group-hover:text-new-mint transition-colors w-8">
                      0{index + 1}
                    </span>
                    <span className="text-6xl font-black text-white/50 group-hover:text-white transition-all duration-300 tracking-tighter group-hover:tracking-normal group-hover:translate-x-4">
                      {link.name}
                    </span>
                    <ArrowUpRight className="w-8 h-8 text-new-mint opacity-0 group-hover:opacity-100 -translate-x-4 group-hover:translate-x-0 transition-all duration-300" />
                  </motion.a>
                ))}
              </nav>

              {/* Footer Info */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="mt-auto pt-8 border-t border-white/10 grid grid-cols-2 gap-8"
              >
                <div>
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-2">Connect</p>
                  <div className="flex gap-4 text-white/60">
                    <a href="#" className="hover:text-white transition-colors">Twitter</a>
                    <a href="#" className="hover:text-white transition-colors">Discord</a>
                  </div>
                </div>
                <div>
                  <p className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-2">Status</p>
                  <div className="flex items-center gap-2 text-off-green text-sm font-bold">
                    <div className="w-2 h-2 rounded-full bg-off-green animate-pulse" />
                    Operational
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

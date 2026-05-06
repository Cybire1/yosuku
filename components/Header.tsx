'use client';

import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

const NAV_LINKS = [
  { name: 'Markets', href: '/markets' },
  { name: 'Pool', href: '/pool' },
  { name: 'Portfolio', href: '/portfolio' },
  { name: 'Leaderboard', href: '/leaderboard' },
  { name: 'Docs', href: '#' },
];

export default function Header() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const shortAddr = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : null;

  return (
    <>
      <header className="header">
        {/* Logo */}
        <a className="logo" href="/markets" data-cursor="hover">
          <span className="logo-mark">
            <svg viewBox="0 0 18 18">
              <line x1="9" y1="2" x2="9" y2="6" stroke="white" strokeWidth="1.4" />
              <line x1="9" y1="12" x2="9" y2="16" stroke="white" strokeWidth="1.4" />
              <rect x="6" y="6" width="6" height="6" fill="none" stroke="white" strokeWidth="1.4" />
              <circle cx="13" cy="6" r="1.4" className="dot" />
            </svg>
          </span>
          <span>YOSUKU</span>
        </a>

        <nav className="nav">
          <div className="nav-links">
            {NAV_LINKS.map(link => {
              const isActive = pathname === link.href || pathname?.startsWith(link.href + '/');
              return (
                <a
                  key={link.name}
                  href={link.href}
                  className={`nav-link ${isActive ? 'active' : ''}`}
                  data-cursor="hover"
                >
                  {link.name}
                </a>
              );
            })}
          </div>

          <div className="header-right">
            {mounted && address && (
              <a className="btn btn-ghost" href="#" data-cursor="hover">
                Faucet ↗
              </a>
            )}

            {mounted && (
              <div data-cursor="hover">
                {address ? (
                  <a className="wallet-pill" href="/portfolio">
                    <span className="addr-dot" />
                    <span>{shortAddr}</span>
                  </a>
                ) : (
                  <ConnectButton />
                )}
              </div>
            )}
          </div>
        </nav>

        {/* Mobile toggle */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden w-10 h-10 flex items-center justify-center text-white"
          style={{ display: 'none' }}
          data-cursor="hover"
        >
          ☰
        </button>
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[900] bg-black/95 backdrop-blur-xl md:hidden flex flex-col p-8">
          <div className="flex justify-between items-center mb-16">
            <span className="font-display font-[800] text-xl tracking-[0.18em]">YOSUKU</span>
            <button
              onClick={() => setMobileOpen(false)}
              className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <nav className="flex flex-col gap-8 flex-1 justify-center">
            {NAV_LINKS.map((link, i) => (
              <a
                key={link.name}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-6 group"
              >
                <span className="text-sm font-mono text-vermilion/40 group-hover:text-vermilion transition-colors w-8">
                  0{i + 1}
                </span>
                <span className="text-3xl font-display font-[800] text-white/50 group-hover:text-white transition-all tracking-tight group-hover:tracking-normal">
                  {link.name}
                </span>
              </a>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}

'use client';

import { useCurrentAccount, useDisconnectWallet, ConnectButton } from '@mysten/dapp-kit';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import AddFunds from './AddFunds';

const NAV_LINKS = [
  { name: 'Bell', href: '/bell' },
  { name: 'Markets', href: '/markets' },
  { name: 'Pool', href: '/pool' },
  { name: 'Portfolio', href: '/portfolio' },
  { name: 'Leaderboard', href: '/leaderboard' },
  { name: 'Strategies', href: '/market' },
  { name: 'Bitcoin News', href: '/news' },
  { name: 'Docs', href: '/docs' },
];

const MOBILE_NAV = [
  {
    name: 'Markets', href: '/markets',
    icon: (
      <svg viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 5-9" /></svg>
    ),
  },
  {
    name: 'Pool', href: '/pool',
    icon: (
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 3c-3 4-3 14 0 18" /><path d="M12 3c3 4 3 14 0 18" /><path d="M3 12h18" /></svg>
    ),
  },
  {
    name: 'Portfolio', href: '/portfolio',
    icon: (
      <svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 0 0-8 0v2" /></svg>
    ),
  },
  {
    name: 'Ranks', href: '/leaderboard',
    icon: (
      <svg viewBox="0 0 24 24"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" /></svg>
    ),
  },
];

export default function Header() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const address = account?.address ?? null;
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showFunds, setShowFunds] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
              <button className="btn btn-ghost" onClick={() => setShowFunds(true)} data-cursor="hover">
                Add funds
              </button>
            )}

            {mounted && (
              <div data-cursor="hover" className="relative">
                {address ? (
                  <>
                    <button
                      className="wallet-pill"
                      onClick={() => setShowMenu(prev => !prev)}
                    >
                      <span className="addr-dot" />
                      <span>{shortAddr}</span>
                    </button>
                    {showMenu && (
                      <div className="absolute right-0 top-full mt-2 z-50 border border-white/10 rounded bg-bg backdrop-blur-md min-w-[160px] py-1">
                        <a
                          href="/portfolio"
                          className="block px-4 py-2 text-xs font-mono text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                          onClick={() => setShowMenu(false)}
                        >
                          Portfolio
                        </a>
                        <button
                          onClick={() => { disconnect(); setShowMenu(false); }}
                          className="block w-full text-left px-4 py-2 text-xs font-mono text-vermilion/70 hover:bg-white/5 hover:text-vermilion transition-colors"
                        >
                          Disconnect
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <ConnectButton />
                )}
              </div>
            )}
          </div>
        </nav>

      </header>

      {/* Mobile floating pill bottom nav */}
      <nav className="mobile-bottom-nav">
        {MOBILE_NAV.map(link => {
          const isActive = pathname === link.href || pathname?.startsWith(link.href + '/');
          return (
            <a key={link.name} href={link.href} className={isActive ? 'active' : ''}>
              {link.icon}
              <span>{link.name}</span>
            </a>
          );
        })}
      </nav>

      <AddFunds open={showFunds} onClose={() => setShowFunds(false)} />
    </>
  );
}

'use client';

import { useCurrentAccount, useDisconnectWallet, ConnectButton } from '@mysten/dapp-kit';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import {
  Activity,
  BadgeDollarSign,
  BookOpen,
  Bot,
  ChartLine,
  ChartNoAxesCombined,
  ChevronDown,
  Coins,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
  Trophy,
  Twitter,
  WalletCards,
  GalleryVerticalEnd,
  type LucideIcon,
} from 'lucide-react';
import AddFunds from './AddFunds';
import CreditWelcome from './CreditWelcome';
import YosukuMark from './YosukuMark';
import ThemeToggle from './ThemeToggle';
import TradingBalanceModal from './TradingBalanceModal';
import { useToast } from './Toast';
import { useDUSDCBalance } from '@/lib/sui/hooks';
import { useAccount624 } from '@/lib/sui/ticket624';

type NavLink = {
  name: string;
  href: string;
  icon?: LucideIcon;
  beta?: boolean;
};

const PRIMARY_NAV: NavLink[] = [
  { name: 'Markets', href: '/markets' },
  { name: 'Reels', href: '/reels' },
  { name: 'Earn', href: '/earn' },
  { name: 'Strategies', href: '/strategies', beta: true },
  { name: 'Leaderboard', href: '/leaderboard', icon: Trophy },
  { name: 'Portfolio', href: '/portfolio' },
];

const SECONDARY_NAV: NavLink[] = [
  { name: 'Sensei', href: '/sensei', icon: MessageSquare },
  { name: 'X-trade', href: '/trade-from-x', icon: Twitter },
  { name: 'Parlay', href: '/parlay', icon: ChartNoAxesCombined },
  { name: 'Surface', href: '/surface', icon: Activity },
  { name: 'Docs', href: '/docs', icon: BookOpen },
];

// Connected users at or below this DUSDC balance get auto-topped-up from the faucet.
const AUTO_FUND_AT = 1_000_000; // 1 DUSDC (6 decimals)

const MOBILE_NAV: NavLink[] = [
  { name: 'Markets', href: '/markets', icon: ChartLine },
  { name: 'Reels', href: '/reels', icon: GalleryVerticalEnd },
  { name: 'Earn', href: '/earn', icon: BadgeDollarSign },
  { name: 'Strategies', href: '/strategies', icon: Bot },
  { name: 'Portfolio', href: '/portfolio', icon: WalletCards },
];

export default function Header() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const address = account?.address ?? null;
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showFunds, setShowFunds] = useState(false);
  const [showBalance, setShowBalance] = useState(false);
  const { balance: dusdcRaw, loading: dusdcLoading, refresh: refreshDusdc } = useDUSDCBalance();
  // The trading balance the header shows is the LIVE 6-24 DeepBook Predict account
  // (the one base bets actually run from) — not the legacy 4-16 vault, which only
  // still backs the leverage/private/cash-out surfaces.
  const { acctBalance: acct624Balance, refreshAcctBalance: refreshTrading } = useAccount624();
  const autoFundingRef = useRef(false);   // in-flight guard (avoid concurrent drips)
  const lowEpisodeRef = useRef(false);    // already auto-funded for the current low episode
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const mobileMoreMenuRef = useRef<HTMLDivElement>(null);
  const walletMenuRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setShowMenu(false);
    setShowMore(false);
  }, [pathname]);

  useEffect(() => {
    const closeFloatingMenus = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        moreMenuRef.current?.contains(target) ||
        mobileMoreMenuRef.current?.contains(target) ||
        walletMenuRef.current?.contains(target)
      ) return;
      setShowMore(false);
      setShowMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowMore(false);
      setShowMenu(false);
    };

    document.addEventListener('pointerdown', closeFloatingMenus);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFloatingMenus);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  // The faucet is reachable from anywhere (the first-run guide, deep links)
  // by dispatching this event — one entry point, no prop drilling.
  useEffect(() => {
    const open = () => setShowFunds(true);
    window.addEventListener('yosuku:open-funds', open);
    return () => window.removeEventListener('yosuku:open-funds', open);
  }, []);

  // Auto top-up: when a connected user falls to ≤ 1 DUSDC, silently drip DUSDC
  // from the in-app faucet — no tap, no hunting. Each page is a FULL reload that mounts a
  // fresh Header, so the in-memory refs below reset on every navigation; the real guard is
  // a per-address cooldown in localStorage (survives reloads) so a low wallet can't
  // re-trigger the faucet — and never the modal — on every page. If the faucet declines
  // (rate-limited / empty) we show a quiet, dismissable toast instead of hijacking the
  // page with the Add-funds modal (the balance pill `+` still opens it on demand).
  useEffect(() => {
    if (!mounted || !address || dusdcLoading) return;
    if (dusdcRaw > AUTO_FUND_AT) { lowEpisodeRef.current = false; return; } // comfortably funded → re-arm
    if (autoFundingRef.current || lowEpisodeRef.current) return;            // already handling this episode
    const cdKey = `yosuku:autofund:${address}`;
    const COOLDOWN_MS = 10 * 60_000; // don't re-attempt within 10 min (survives page reloads)
    try {
      if (Date.now() - Number(localStorage.getItem(cdKey) || 0) < COOLDOWN_MS) {
        lowEpisodeRef.current = true; // recently handled — stay quiet this page
        return;
      }
    } catch { /* localStorage unavailable — fall through */ }
    lowEpisodeRef.current = true;
    autoFundingRef.current = true;
    try { localStorage.setItem(cdKey, String(Date.now())); } catch { /* ignore */ }
    (async () => {
      try {
        const r = await fetch('/api/faucet', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok && !d.error) {
          refreshDusdc();
          if (!d.alreadyFunded) {
            const amount = d.amount ?? 2;
            // The FIRST silent credit for an address is the "you're funded" moment —
            // a prominent celebratory card (CreditWelcome) so a new user actually sees
            // it happen. Routine top-ups after that use a quiet toast, not a takeover.
            let firstTime = false;
            try {
              const wk = `yosuku:welcomed:${address}`;
              firstTime = !localStorage.getItem(wk);
              if (firstTime) localStorage.setItem(wk, '1');
            } catch { /* localStorage unavailable — fall back to a toast */ }
            if (firstTime) {
              window.dispatchEvent(new CustomEvent('yosuku:credited', { detail: { amount, firstTime: true } }));
            } else {
              toast(`${amount} DUSDC added to your wallet automatically`, 'success');
            }
          }
        } else {
          // rate-limited / empty — a quiet cue, NOT a forced modal on every page.
          toast('Faucet busy — tap your balance to add DUSDC', 'info');
        }
      } catch { /* network hiccup — clear cooldown so the next balance tick can retry */
        try { localStorage.removeItem(cdKey); } catch { /* ignore */ }
        lowEpisodeRef.current = false;
      } finally { autoFundingRef.current = false; }
    })();
  }, [mounted, address, dusdcLoading, dusdcRaw, refreshDusdc, toast]);

  const shortAddr = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : null;
  const isActiveHref = (href: string) => pathname === href || pathname?.startsWith(href + '/');
  const secondaryActive = SECONDARY_NAV.some(link => isActiveHref(link.href));

  return (
    <>
      <header className="header">
        {/* Logo */}
        <a className="logo" href="/markets" aria-label="Yosuku markets" data-cursor="hover">
          <span className="logo-mark">
            <YosukuMark />
          </span>
          <span>YOSUKU</span>
        </a>

        <nav className="nav" aria-label="Primary navigation">
          <div className="nav-links">
            {PRIMARY_NAV.map(link => {
              const isActive = isActiveHref(link.href);
              return (
                <a
                  key={link.name}
                  href={link.href}
                  className={`nav-link ${isActive ? 'active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  data-cursor="hover"
                >
                  {link.name}
                  {link.beta && <sup className="nav-beta">beta</sup>}
                </a>
              );
            })}
            <div className="nav-more" ref={moreMenuRef}>
              <button
                type="button"
                className={`nav-link nav-more-button ${secondaryActive ? 'active' : ''} ${showMore ? 'open' : ''}`}
                onClick={() => {
                  setShowMore(prev => !prev);
                  setShowMenu(false);
                }}
                aria-haspopup="menu"
                aria-expanded={showMore}
                aria-controls="secondary-nav-menu"
                data-cursor="hover"
              >
                More
                <ChevronDown aria-hidden="true" />
              </button>
              {showMore && (
                <div className="nav-more-menu" id="secondary-nav-menu" role="menu">
                  {SECONDARY_NAV.map(link => {
                    const isActive = isActiveHref(link.href);
                    const Icon = link.icon;
                    return (
                      <a
                        key={link.name}
                        href={link.href}
                        className={`nav-more-link ${isActive ? 'active' : ''}`}
                        role="menuitem"
                        aria-current={isActive ? 'page' : undefined}
                        data-cursor="hover"
                      >
                        {Icon && <Icon aria-hidden="true" />}
                        <span>{link.name}</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="header-right">
            <ThemeToggle />
            {mounted && address && (
              <button
                onClick={() => setShowBalance(true)}
                data-cursor="hover"
                title="Tap to move funds between your wallet and your Trading Balance."
                className="dusdc-pill flex items-center gap-1.5 font-mono text-[12px] px-2.5 sm:px-3 py-1.5 rounded-full border border-white/10 hover:border-white/25 hover:bg-white/[0.03] text-gray-300 hover:text-white transition-colors"
              >
                {/* One compact total — the Trading · Wallet split lives in the Move-funds modal.
                    On phones the icon + number carry it; the unit label costs too much width. */}
                <span className="flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-white font-semibold tabular-nums">{(acct624Balance + dusdcRaw / 1e6).toFixed(2)}</span>
                  <span className="hidden sm:inline text-gray-500">DUSDC</span>
                </span>
                <span className="text-vermilion font-bold ml-0.5 text-[15px] leading-none">+</span>
              </button>
            )}

            {mounted && (
              <div data-cursor="hover" className="relative" ref={walletMenuRef}>
                {address ? (
                  <>
                    <button
                      className="wallet-pill"
                      type="button"
                      aria-label="Open account menu"
                      aria-haspopup="menu"
                      aria-expanded={showMenu}
                      onClick={() => {
                        setShowMenu(prev => !prev);
                        setShowMore(false);
                      }}
                    >
                      <span className="addr-dot" />
                      <span>{shortAddr}</span>
                    </button>
                    {showMenu && (
                      <div className="absolute right-0 top-full mt-2 z-50 border border-white/10 rounded bg-bg backdrop-blur-md min-w-[160px] py-1" role="menu">
                        <div className="px-4 py-3 border-b border-white/[0.06]">
                          <div className="flex items-center justify-between gap-4 font-mono text-[11px]">
                            <span className="text-gray-500">Trading account</span>
                            <span className="text-white tabular-nums">{acct624Balance.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 font-mono text-[11px] mt-1">
                            <span className="text-gray-500">Wallet</span>
                            <span className="text-white/80 tabular-nums">{(dusdcRaw / 1e6).toFixed(2)}</span>
                          </div>
                        </div>
                        <a
                          href="/portfolio"
                          className="block px-4 py-2 text-xs font-mono text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                          onClick={() => setShowMenu(false)}
                          role="menuitem"
                        >
                          Portfolio
                        </a>
                        <button
                          onClick={() => { disconnect(); setShowMenu(false); }}
                          className="block w-full text-left px-4 py-2 text-xs font-mono text-vermilion/70 hover:bg-white/5 hover:text-vermilion transition-colors"
                          role="menuitem"
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
      <div ref={mobileMoreMenuRef}>
        <nav className="mobile-bottom-nav" aria-label="Mobile primary navigation">
          {MOBILE_NAV.map(link => {
            const isActive = isActiveHref(link.href);
            const Icon = link.icon;
            return (
              <a key={link.name} href={link.href} className={isActive ? 'active' : ''} aria-current={isActive ? 'page' : undefined}>
                {Icon && <Icon aria-hidden="true" />}
                <span>{link.name}</span>
              </a>
            );
          })}
          <button
            type="button"
            className={secondaryActive || showMore ? 'active' : ''}
            aria-haspopup="menu"
            aria-expanded={showMore}
            aria-controls="mobile-more-menu"
            onClick={() => {
              setShowMore(prev => !prev);
              setShowMenu(false);
            }}
          >
            <MoreHorizontal aria-hidden="true" />
            <span>More</span>
          </button>
        </nav>

        {showMore && (
          <div className="mobile-more-menu" id="mobile-more-menu" role="menu">
            {SECONDARY_NAV.map(link => {
              const isActive = isActiveHref(link.href);
              const Icon = link.icon;
              return (
                <a
                  key={link.name}
                  href={link.href}
                  className={isActive ? 'active' : ''}
                  role="menuitem"
                  aria-current={isActive ? 'page' : undefined}
                >
                  {Icon && <Icon aria-hidden="true" />}
                  <span>{link.name}</span>
                </a>
              );
            })}
          </div>
        )}
      </div>

      <CreditWelcome />

      <AddFunds open={showFunds} onClose={() => setShowFunds(false)} onFunded={() => { refreshDusdc(); refreshTrading(); }} />
      {showBalance && <TradingBalanceModal onClose={() => { setShowBalance(false); refreshDusdc(); refreshTrading(); }} />}
    </>
  );
}

'use client';

// /reels — the Yosuku feed. A Twitter-shaped social timeline wired to the LIVE
// 6-24 venue: the hero post is a real market "line" whose reply-to-bet UP/DOWN
// places a real, gasless, un-drainable bet on-chain (ticket624), the "Live lines"
// rail is real near markets, and the feed is real community takes from the on-chain
// take_board. Identity shows the author address until you.yosuku names ship (next).
// Design is the design-critique-panel refinement: vermilion concentrated on the
// hero, line card as a collectible betting slip, tabular figures, Noto Serif JP.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import type { Transaction } from '@mysten/sui/transactions';
import { useToast } from '@/components/Toast';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import {
  useAccount624, placeMint624, placeFirstBet624, placeTopUpAndBet624,
  qtyForStake, BAND_USD, minMintMs,
} from '@/lib/sui/ticket624';
import { fetchMarkets624, fetchSpot624, fetchPythHistory624, type Market624 } from '@/lib/sui/predict624Client';
import { fetchTakes, type FeedTake } from '@/lib/sui/takeBoard';
import TakeComposer624 from '@/components/TakeComposer624';
import {
  Home, LineChart, Clapperboard, Users, Bell, User, Feather, Search,
  MessageCircle, Repeat2, Heart, BarChart3, Bookmark, Share, MoreHorizontal,
  BadgeCheck, Sparkles, TrendingUp, TrendingDown,
} from 'lucide-react';

type Dir = 'up' | 'down';

/* ── brand mark: celebrant (arms up "V" + torso + vermilion dot) ── */
function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 28" width={size} height={size} aria-hidden fill="none">
      <circle cx="12" cy="4" r="3" fill="var(--vermilion)" />
      <path d="M12 8v11M12 12 5 8M12 12l7-4M12 19l-5 7M12 19l5 7"
        stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

const NAV = [
  { icon: Home, label: 'Home', active: true },
  { icon: LineChart, label: 'Markets' },
  { icon: Clapperboard, label: 'Reels' },
  { icon: Users, label: 'Circles' },
  { icon: Bell, label: 'Notifications' },
  { icon: User, label: 'Profile' },
];

const usd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const shortName = (a: string) => (a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || 'anon');
const timeAgo = (ms: number) => {
  if (!ms) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

// Entry probability that BTC finishes above `line` (the word-market logistic),
// so each side shows its own honest odds.
function probAbove(spot: number, line: number, msLeft: number): number {
  const secs = Math.max(45, msLeft / 1000);
  const sigma = spot * 0.00028 * Math.sqrt(secs / 60);
  const z = (spot - line) / (sigma || 1);
  return Math.max(0.03, Math.min(0.97, 1 / (1 + Math.exp(-1.15 * z))));
}
const payoutX = (p: number) => Math.max(1.05, 1 / p);

// Build an SVG sparkline (0..320 x, 0..72 y) from a price series + the win-line.
function sparkGeom(series: number[], line: number | null) {
  const s = series.length > 50 ? series.slice(-50) : series;
  const n = s.length;
  if (n < 2) return null;
  const vals = line != null ? [...s, line] : s;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.18; lo -= pad; hi += pad;
  const W = 320, H = 72;
  const X = (i: number) => (i / (n - 1)) * W;
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const pts = s.map((v, i) => `${X(i).toFixed(1)} ${Y(v).toFixed(1)}`);
  return {
    line: `M${pts.join(' L')}`,
    area: `M0 ${H} L${pts.join(' L')} L${W} ${H} Z`,
    dotY: Y(s[n - 1]),
    winY: line != null ? Y(line) : null,
  };
}

type Stat = { replies: number; reposts: number; likes: number; views: string };
function Actions({ s }: { s: Stat }) {
  return (
    <div className="yx-actions">
      <button className="yx-act reply"><MessageCircle size={17} /><span>{fmt(s.replies)}</span></button>
      <button className="yx-act repost"><Repeat2 size={17} /><span>{fmt(s.reposts)}</span></button>
      <button className="yx-act like"><Heart size={17} /><span>{fmt(s.likes)}</span></button>
      <button className="yx-act views"><BarChart3 size={17} /><span>{s.views}</span></button>
      <span className="yx-act-end">
        <button className="yx-act"><Bookmark size={16} /></button>
        <button className="yx-act"><Share size={16} /></button>
      </span>
    </div>
  );
}

/* ── the LIVE betting slip — real market, real odds, functional reply-to-bet ── */
function LineCard({
  market, spot, series, now, connected, busy, onBet,
}: {
  market: Market624; spot: number; series: number[]; now: number;
  connected: boolean; busy: Dir | null; onBet: (dir: Dir, stake: number) => void;
}) {
  const [stake, setStake] = useState('5');
  // Freeze the win-lines the first time we see this market so the dashed line
  // holds still while the price moves toward it.
  const frozen = useRef<{ id: string; up: number; down: number } | null>(null);
  if (frozen.current?.id !== market.id) {
    frozen.current = { id: market.id, up: Math.round(spot - BAND_USD), down: Math.round(spot + BAND_USD) };
  }
  const upLine = frozen.current!.up, downLine = frozen.current!.down;
  const msLeft = now > 0 ? Math.max(0, market.expiry - now) : 0;
  const urgent = msLeft <= minMintMs(market.cadence);
  const probUp = probAbove(spot, upLine, msLeft);
  const probDown = 1 - probAbove(spot, downLine, msLeft);
  const cadWord = { '1m': '1-MIN', '5m': '5-MIN', '1h': 'HOURLY' }[market.cadence] ?? market.cadence;
  const g = sparkGeom(series, upLine);
  const stakeN = Math.max(0, Number(stake) || 0);

  return (
    <div className="yx-line">
      <span className="yx-line-kanji" aria-hidden>予</span>
      <div className="yx-line-brand">
        <span className="yx-line-mark"><Mark size={13} /> YOSUKU <i className="yx-jp">予測</i></span>
        <span className="yx-line-no">LINE OPEN · {cadWord}</span>
      </div>
      <div className="yx-line-head">
        <span className="yx-line-q">BTC over <b>{usd0(upLine)}</b></span>
        <span className="yx-line-cadwrap" data-urgent={urgent ? 'y' : undefined}>
          <span className="yx-live-dot" />
          <span className="yx-line-cad">closes</span>
          <span className="yx-clock">{mmss(msLeft)}</span>
        </span>
      </div>
      <div className="yx-spark">
        <svg viewBox="0 0 320 72" preserveAspectRatio="none" width="100%" height="72">
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--profit)" stopOpacity="0.26" />
              <stop offset="1" stopColor="var(--profit)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {g ? (
            <>
              <path d={g.area} fill="url(#lg)" />
              <path className="yx-spark-path" d={g.line} pathLength={1} fill="none" stroke="var(--profit)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {g.winY != null && <line x1="0" y1={g.winY} x2="320" y2={g.winY} stroke="var(--vermilion)" strokeWidth="1.4" strokeDasharray="3 4" opacity="0.95" />}
            </>
          ) : null}
        </svg>
        {g && <span className="yx-spark-dot" style={{ top: `${g.dotY}px` }} />}
        {g && g.winY != null && <span className="yx-winline" style={{ top: `${g.winY}px` }}>YOUR LINE · {usd0(upLine)}</span>}
      </div>
      <div className="yx-odds">
        <span className="yx-odd up">
          <span className="yx-odd-lab"><TrendingUp size={13} /> UP {Math.round(probUp * 100)}% · pays</span>
          <span className="yx-odd-x">{payoutX(probUp).toFixed(2)}×</span>
        </span>
        <span className="yx-odd dn">
          <span className="yx-odd-lab"><TrendingDown size={13} /> DOWN {Math.round(probDown * 100)}% · pays</span>
          <span className="yx-odd-x">{payoutX(probDown).toFixed(2)}×</span>
        </span>
      </div>
      <div className="yx-oddsbar"><i className="up" style={{ width: `${Math.round(probUp * 100)}%` }} /><i className="dn" style={{ width: `${Math.round(probDown * 100)}%` }} /></div>
      {connected ? (
        <div className="yx-reply2bet">
          <span className="yx-r2b-amt"><span>$</span><input value={stake} onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" aria-label="Stake in DUSDC" /></span>
          <button className="yx-r2b up" disabled={!!busy || stakeN <= 0} onClick={() => onBet('up', stakeN)}>{busy === 'up' ? '…' : <><TrendingUp size={13} /> UP</>}</button>
          <button className="yx-r2b dn" disabled={!!busy || stakeN <= 0} onClick={() => onBet('down', stakeN)}>{busy === 'down' ? '…' : <><TrendingDown size={13} /> DOWN</>}</button>
        </div>
      ) : (
        <div className="yx-reply2bet yx-connect-row"><span className="yx-connect"><ConnectButton connectText="Connect a wallet to reply" /></span></div>
      )}
      <div className="yx-r2b-note">Your reply becomes your position. UP wins above {usd0(upLine)}, DOWN below {usd0(downLine)}. Settled by the oracle, paid straight to your wallet.</div>
    </div>
  );
}

function Avatar({ name, agent, size = 44 }: { name: string; agent?: boolean; size?: number }) {
  const initial = (name.replace(/^0x/, '')[0] ?? 'Y').toUpperCase();
  return (
    <span className="yx-av" style={{ width: size, height: size, fontSize: size * 0.4 }} data-agent={agent ? 'y' : undefined}>
      {agent ? <Mark size={size * 0.5} /> : initial}
    </span>
  );
}
function Verified({ agent, house }: { agent?: boolean; house?: boolean }) {
  return <BadgeCheck size={16} className="yx-tick" data-agent={agent ? 'y' : undefined} data-house={house ? 'y' : undefined} />;
}

// map a take to a plain-words call line if it has no caption
function takeBody(t: FeedTake): string {
  if (t.caption && t.caption.trim()) return t.caption.trim();
  const side = t.side === 0 ? 'UP' : t.side === 1 ? 'DOWN' : 'a range';
  const at = t.strikeUsd ? ` at ${usd0(t.strikeUsd)}` : '';
  return `Called ${side} on BTC${at}.`;
}

export default function ReelsFeed() {
  const account = useCurrentAccount();
  const { toast } = useToast();
  const { submit } = useSmartSubmit();
  const acct = useAccount624();

  const [tab, setTab] = useState<'for' | 'following'>('for');
  const [composerOpen, setComposerOpen] = useState(false);
  const [busy, setBusy] = useState<Dir | null>(null);

  // 1s clock
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);

  // live markets (15s) + spot (5s) + pyth tape (15s) + takes (20s)
  const [markets, setMarkets] = useState<Market624[]>([]);
  const [spot, setSpot] = useState<number | null>(null);
  const [series, setSeries] = useState<number[]>([]);
  const [takes, setTakes] = useState<FeedTake[]>([]);
  const reloadTakes = useMemo(() => () => { fetchTakes(30).then(setTakes).catch(() => {}); }, []);
  useEffect(() => {
    let dead = false;
    const loadM = () => fetchMarkets624().then((m) => { if (!dead) setMarkets(m); }).catch(() => {});
    const loadS = () => fetchSpot624().then((s) => { if (!dead) setSpot(Math.round(s)); }).catch(() => {});
    const loadH = () => fetchPythHistory624(150).then((h) => { if (!dead && h.length > 5) setSeries(h.map((x) => x.usd)); }).catch(() => {});
    loadM(); loadS(); loadH(); reloadTakes();
    const a = setInterval(loadM, 15000), b = setInterval(loadS, 5000), c = setInterval(loadH, 15000), d = setInterval(reloadTakes, 20000);
    return () => { dead = true; [a, b, c, d].forEach(clearInterval); };
  }, [reloadTakes]);

  const liveSeries = useMemo(() => (spot != null && series.length > 1 ? [...series, spot] : series), [series, spot]);
  const rounds = useMemo(() => {
    const t = now || Date.now();
    return markets.filter((m) => m.expiry - t > minMintMs(m.cadence) * 0.6).sort((a, b) => a.expiry - b.expiry);
  }, [markets, now]);
  const hero = rounds[0] ?? null;
  const railMarkets = rounds.slice(0, 3);

  async function place(market: Market624, dir: Dir, stake: number) {
    if (!account?.address || spot == null || busy || stake <= 0) return;
    setBusy(dir);
    try {
      const sponsored = (factory: () => Transaction) => submit(factory).then((x) => x.digest);
      const qty = qtyForStake(stake, 1, 0.5);
      const walletD = acct.walletMicro / DUSDC_MULTIPLIER;
      const base = { submit: sponsored, address: account.address, marketId: market.id, dir, qty, lev: 1, spot, cadence: market.cadence };
      if (!acct.wrapperId) {
        await placeFirstBet624({ ...base, stakeDusdc: stake, walletDusdcMicro: BigInt(Math.floor(acct.walletMicro)), coinIds: acct.dusdcCoins.map((c) => c.coinObjectId) });
        acct.refreshWallet();
      } else if (acct.acctBalance < stake && walletD > 0.01 && acct.acctBalance + walletD >= stake) {
        await placeTopUpAndBet624({ ...base, wrapperId: acct.wrapperId, stakeDusdc: stake, acctBalance: acct.acctBalance, walletDusdcMicro: BigInt(Math.floor(acct.walletMicro)), coinIds: acct.dusdcCoins.map((c) => c.coinObjectId) });
        acct.refreshWallet();
      } else {
        await placeMint624({ ...base, wrapperId: acct.wrapperId, acctBalance: acct.acctBalance });
      }
      acct.refreshAcctBalance();
      toast(`You're in. ${dir.toUpperCase()} on BTC.`, 'success');
    } catch (e) {
      const raw = String(e instanceof Error ? e.message : e);
      const friendly = /no DUSDC|faucet|to top up/i.test(raw) ? 'You need test dollars first. Add money, then bet.'
        : /abort code:?\s*1|EBalanceTooLow|below the live cost|deposit a little more|not enough/i.test(raw) ? 'Your trading account needs funds. Add money, then bet.'
        : `Could not place: ${raw.slice(0, 90)}`;
      toast(friendly, 'error');
    } finally { setBusy(null); }
  }

  return (
    <div className="yx-root">
      {/* LEFT NAV */}
      <aside className="yx-nav">
        <div className="yx-brand"><Mark size={32} /><i className="yx-jp yx-brand-jp">予測</i></div>
        <nav className="yx-navlist">
          {NAV.map((n) => (
            <button key={n.label} className={`yx-navitem ${n.active ? 'on' : ''}`}>
              <n.icon size={24} strokeWidth={n.active ? 2.4 : 1.9} /><span>{n.label}</span>
            </button>
          ))}
          <button className="yx-navitem"><MoreHorizontal size={24} /><span>More</span></button>
        </nav>
        <button className="yx-post-btn" onClick={() => setComposerOpen(true)}><span className="yx-post-lg">Post a call</span><Feather size={22} className="yx-post-sm" /></button>
        {account ? (
          <button className="yx-me">
            <Avatar name={account.address} size={40} />
            <span className="yx-me-id">
              <b>{shortName(account.address)} <Verified /></b>
              <i><span className="yx-me-name">claim your name</span> · <span className="yx-me-key">your key</span></i>
            </span>
            <MoreHorizontal size={18} />
          </button>
        ) : (
          <span className="yx-me-connect"><ConnectButton connectText="Connect wallet" /></span>
        )}
      </aside>

      {/* CENTER TIMELINE */}
      <main className="yx-feed">
        <header className="yx-feedhead">
          <h1><Mark size={16} /> Home <i className="yx-jp yx-head-jp">予測</i></h1>
          <div className="yx-tabs">
            <button className={tab === 'for' ? 'on' : ''} onClick={() => setTab('for')}>For you</button>
            <button className={tab === 'following' ? 'on' : ''} onClick={() => setTab('following')}>Following</button>
          </div>
        </header>

        {/* composer */}
        <div className="yx-composer">
          <Avatar name={account?.address ?? 'Y'} size={44} />
          <div className="yx-comp-body">
            <input className="yx-comp-input" placeholder="What's your call?" onFocus={() => setComposerOpen(true)} readOnly />
            <div className="yx-comp-row">
              <span className="yx-comp-tools"><LineChart size={18} /><Sparkles size={18} /><BarChart3 size={18} /></span>
              <button className="yx-comp-post" onClick={() => setComposerOpen(true)}>Post</button>
            </div>
          </div>
        </div>

        {/* HERO — a real live line, reply to bet */}
        <article className="yx-post">
          <Avatar name="Y" />
          <div className="yx-post-body">
            <div className="yx-post-head">
              <b>Yosuku</b><Verified house /><span className="yx-handle">@yosuku</span>
              <span className="yx-dot">·</span><span className="yx-time">live</span>
              <MoreHorizontal size={17} className="yx-post-more" />
            </div>
            <div className="yx-post-text">A line is open. Reply <b>UP</b> or <b>DOWN</b> with your stake and that reply becomes your bet, settled by the oracle, paid straight to your wallet.</div>
            {hero && spot != null
              ? <LineCard market={hero} spot={spot} series={liveSeries} now={now} connected={!!account} busy={busy} onBet={(dir, stake) => place(hero, dir, stake)} />
              : <div className="yx-line yx-line-empty">{spot == null ? 'Reading the market…' : 'Between lines. A new one opens every minute.'}</div>}
            <Actions s={{ replies: takes.length, reposts: 12, likes: 128, views: '38K' }} />
          </div>
        </article>

        {/* real community takes */}
        {takes.map((t) => (
          <article className="yx-post" key={`${t.blobId}-${t.tsMs}`}>
            <Avatar name={t.author} />
            <div className="yx-post-body">
              <div className="yx-post-head">
                <b>{shortName(t.author)}</b>
                <span className="yx-handle">on-chain</span>
                <span className="yx-dot">·</span><span className="yx-time">{timeAgo(t.tsMs)}</span>
                {t.digest && <a className="yx-verifylink" href={`https://suiscan.xyz/testnet/tx/${t.digest}`} target="_blank" rel="noreferrer">verify</a>}
                <MoreHorizontal size={17} className="yx-post-more" />
              </div>
              <div className="yx-post-text">{takeBody(t)}</div>
              {t.backed && <div className="yx-backed"><BadgeCheck size={14} /> backed by a live position{t.stakeDusdc ? ` · $${t.stakeDusdc.toFixed(2)}` : ''}</div>}
              <Actions s={{ replies: 0, reposts: 0, likes: 0, views: '—' }} />
            </div>
          </article>
        ))}
        {takes.length === 0 && (
          <div className="yx-feedempty">No takes yet. Be the first, tap <b>Post a call</b>.</div>
        )}
      </main>

      {/* RIGHT RAIL */}
      <aside className="yx-rail">
        <div className="yx-search"><Search size={18} /><input placeholder="Search Yosuku" readOnly /></div>
        <section className="yx-widget">
          <h2>Live lines <span className="yx-livetag"><i />LIVE</span></h2>
          {railMarkets.length ? railMarkets.map((m, i) => {
            const line = spot != null ? Math.round(spot - BAND_USD) : null;
            const p = spot != null ? probAbove(spot, line ?? spot, Math.max(0, m.expiry - (now || Date.now()))) : 0.5;
            const cad = { '1m': '1-min', '5m': '5-min', '1h': '1-hour' }[m.cadence] ?? m.cadence;
            return (
              <button className="yx-mkt" key={m.id}>
                <span className="yx-mkt-no">{String(i + 1).padStart(2, '0')}</span>
                <span className="yx-mkt-q">BTC over {line != null ? usd0(line) : '—'}</span>
                <span className="yx-mkt-meta">
                  <span className="yx-mkt-cad">{cad}</span>
                  <span className="yx-mkt-pct up"><TrendingUp size={13} />{Math.round(p * 100)}%</span>
                </span>
              </button>
            );
          }) : <div className="yx-mkt-empty">Between rounds…</div>}
          <button className="yx-more">Show more</button>
        </section>
        <section className="yx-widget">
          <h2>Who to follow <i className="yx-jp yx-widget-jp">予測</i></h2>
          <div className="yx-follow">
            <Avatar name="Sensei" agent size={40} />
            <span className="yx-follow-id"><b>Sensei <Verified agent /></b><i>the house agent</i><em>reads every line with you</em></span>
            <button className="yx-follow-btn">Follow</button>
          </div>
          {[...new Map(takes.map((t) => [t.author, t])).values()].slice(0, 3).map((t) => (
            <div className="yx-follow" key={t.author}>
              <Avatar name={t.author} size={40} />
              <span className="yx-follow-id"><b>{shortName(t.author)}</b><i>on-chain</i><em>posted a call</em></span>
              <button className="yx-follow-btn">Follow</button>
            </div>
          ))}
        </section>
        <p className="yx-legal">Every name is yours. Every call is on-chain. yosuku.xyz · testnet</p>
      </aside>

      {composerOpen && <TakeComposer624 onClose={() => setComposerOpen(false)} onPosted={reloadTakes} />}

      <style jsx global>{`
        .yx-root {
          --t-display: 30px; --t-title: 22px; --t-head: 17px; --t-body: 15px;
          --t-meta: 13px; --t-label: 11px; --t-micro: 10px;
          --jp: var(--font-noto-serif-jp), 'Noto Serif JP', serif;
          display: grid; grid-template-columns: 276px minmax(0, 600px) 348px;
          max-width: 1224px; margin: 0 auto; min-height: 100vh;
          color: var(--white); font-family: var(--font-display);
        }
        .yx-root button { cursor: pointer; font-family: inherit; }
        .yx-jp { font-family: var(--jp); font-style: normal; }
        .yx-act, .yx-odd-x, .yx-mkt-pct, .yx-mkt-no, .yx-line-cad, .yx-clock, .yx-winline,
        .yx-r2b, .yx-r2b-amt, .yx-betchip, .yx-backed, .yx-handle, .yx-line-no {
          font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
        }

        .yx-nav { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; align-items: flex-start; padding: 8px 10px; gap: 4px; border-right: 1px solid var(--gray-800); }
        .yx-brand { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 10px 12px 6px; color: var(--white); }
        .yx-brand-jp { font-size: var(--t-label); color: var(--vermilion); letter-spacing: 0.28em; opacity: 0.85; padding-left: 0.28em; }
        .yx-navlist { display: flex; flex-direction: column; gap: 2px; width: 100%; }
        .yx-navitem { display: flex; align-items: center; gap: 16px; padding: 12px 16px; border: none; background: none; color: var(--white); font-size: 19px; border-radius: 999px; transition: background 140ms var(--ease); width: fit-content; }
        .yx-navitem span { padding-right: 6px; }
        .yx-navitem:hover { background: color-mix(in srgb, var(--white) 8%, transparent); }
        .yx-navitem.on { font-weight: 700; }
        .yx-navitem.on svg { color: var(--vermilion); }
        .yx-post-btn { margin: 16px 0 0; width: 100%; padding: 15px 0; background: var(--vermilion); color: #fff; border: none; border-radius: 999px; font-size: 16px; font-weight: 700; box-shadow: 0 10px 26px -14px color-mix(in srgb, var(--vermilion) 45%, transparent); transition: transform 120ms var(--ease), background 140ms var(--ease); }
        .yx-post-btn:hover { background: var(--vermilion-d); transform: translateY(-1px); }
        .yx-post-sm { display: none; }
        .yx-me { margin-top: auto; margin-bottom: 6px; display: flex; align-items: center; gap: 11px; width: 100%; padding: 10px 16px; border: none; background: none; border-radius: 999px; color: var(--white); text-align: left; transition: background 140ms var(--ease); }
        .yx-me:hover { background: color-mix(in srgb, var(--white) 7%, transparent); }
        .yx-me-id { display: flex; flex-direction: column; line-height: 1.25; flex: 1; min-width: 0; }
        .yx-me-id b { font-size: 14px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px; font-family: var(--font-mono); }
        .yx-me-id i { font-size: 12px; color: var(--gray-500); font-style: normal; font-family: var(--font-mono); }
        .yx-me-key { color: color-mix(in srgb, var(--vermilion) 72%, var(--gray-400)); letter-spacing: 0.02em; }
        .yx-me-connect { margin-top: auto; margin-bottom: 10px; width: 100%; }

        .yx-av { flex: none; display: grid; place-items: center; border-radius: 999px; background: linear-gradient(150deg, var(--gray-700), var(--gray-900)); color: var(--white); font-weight: 700; font-family: var(--font-display); border: 1px solid var(--gray-800); }
        .yx-av[data-agent] { background: linear-gradient(150deg, color-mix(in srgb, var(--vermilion) 30%, var(--gray-900)), var(--gray-950)); border-color: color-mix(in srgb, var(--vermilion) 40%, transparent); color: var(--vermilion); }
        .yx-tick { color: var(--gray-400); flex: none; }
        .yx-tick[data-agent], .yx-tick[data-house] { color: var(--vermilion); }

        .yx-feed { border-right: 1px solid var(--gray-800); min-height: 100vh; }
        .yx-feedhead { position: sticky; top: 0; z-index: 5; backdrop-filter: blur(12px); background: color-mix(in srgb, var(--bg) 72%, transparent); border-bottom: 1px solid var(--gray-800); }
        .yx-feedhead h1 { display: flex; align-items: center; gap: 8px; font-size: var(--t-title); font-weight: 800; padding: 14px 16px 10px; letter-spacing: -0.02em; line-height: 1.1; }
        .yx-head-jp { margin-left: auto; font-size: 14px; color: var(--vermilion); opacity: 0.9; }
        .yx-tabs { display: grid; grid-template-columns: 1fr 1fr; }
        .yx-tabs button { position: relative; padding: 15px 0; border: none; background: none; color: var(--gray-500); font-size: var(--t-body); font-weight: 600; transition: background 140ms var(--ease), color 140ms var(--ease); }
        .yx-tabs button:hover { background: color-mix(in srgb, var(--white) 5%, transparent); }
        .yx-tabs button.on { color: var(--white); font-weight: 700; }
        .yx-tabs button.on::after { content: ''; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 56px; height: 4px; border-radius: 4px; background: var(--vermilion); }

        .yx-composer { display: flex; gap: 12px; padding: 14px 16px 6px; border-bottom: 1px solid color-mix(in srgb, var(--gray-800) 55%, transparent); }
        .yx-comp-body { flex: 1; }
        .yx-comp-input { width: 100%; background: none; border: none; outline: none; color: var(--white); font-size: 20px; padding: 10px 0; font-family: var(--font-display); cursor: text; }
        .yx-comp-input::placeholder { color: var(--gray-600); }
        .yx-comp-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0 12px; }
        .yx-comp-tools { display: flex; gap: 16px; color: var(--gray-500); }
        .yx-comp-tools svg { transition: color 130ms var(--ease); }
        .yx-comp-tools svg:hover { color: var(--vermilion); }
        .yx-comp-post { padding: 9px 20px; background: var(--vermilion); color: #fff; border: none; border-radius: 999px; font-weight: 700; font-size: 13.5px; }
        .yx-comp-post:hover { background: var(--vermilion-d); }

        .yx-post { display: flex; gap: 12px; padding: 13px 16px 4px; border-bottom: 1px solid color-mix(in srgb, var(--gray-800) 55%, transparent); transition: background 120ms var(--ease); }
        .yx-post:hover { background: color-mix(in srgb, var(--white) 2.5%, transparent); }
        .yx-post-body { flex: 1; min-width: 0; }
        .yx-post-head { display: flex; align-items: center; gap: 5px; font-size: var(--t-body); }
        .yx-post-head b { font-weight: 700; }
        .yx-handle, .yx-time, .yx-dot { color: var(--gray-500); font-weight: 400; }
        .yx-handle { font-family: var(--font-mono); font-size: 13px; }
        .yx-verifylink { margin-left: 4px; font-family: var(--font-mono); font-size: var(--t-micro); color: var(--gray-500); text-transform: uppercase; letter-spacing: 0.1em; text-decoration: none; }
        .yx-verifylink:hover { color: var(--vermilion); }
        .yx-post-more { margin-left: auto; color: var(--gray-600); }
        .yx-post-text { font-size: var(--t-body); line-height: 1.45; margin: 3px 0 2px; color: var(--gray-100); }
        .yx-post-text b { color: var(--white); font-weight: 700; }
        .yx-betchip { display: inline-block; font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--profit); background: color-mix(in srgb, var(--profit) 14%, transparent); border: 1px solid color-mix(in srgb, var(--profit) 40%, transparent); padding: 1px 8px; border-radius: 6px; margin-right: 4px; }
        .yx-backed { display: inline-flex; align-items: center; gap: 5px; margin: 10px 0 2px; font-family: var(--font-mono); font-size: 12px; color: var(--profit); background: color-mix(in srgb, var(--profit) 10%, transparent); border: 1px solid color-mix(in srgb, var(--profit) 28%, transparent); padding: 5px 10px; border-radius: 8px; }

        .yx-line { position: relative; margin: 14px 0 4px; border-radius: 16px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--vermilion) 20%, var(--gray-800)); background: color-mix(in srgb, var(--white) 4.5%, var(--bg)); box-shadow: inset 0 1px 0 color-mix(in srgb, var(--white) 7%, transparent), 0 20px 46px -22px rgba(0,0,0,0.85); }
        .yx-line-empty { padding: 34px 16px; text-align: center; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.06em; color: var(--gray-500); }
        .yx-line-kanji { position: absolute; top: -14px; right: 6px; font-family: var(--jp); font-size: 96px; line-height: 1; color: var(--vermilion); opacity: 0.06; pointer-events: none; user-select: none; }
        .yx-line-brand { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 11px 16px; border-bottom: 1px dashed color-mix(in srgb, var(--gray-800) 80%, transparent); }
        .yx-line-mark { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; font-size: 12.5px; letter-spacing: 0.04em; color: var(--gray-400); }
        .yx-line-mark .yx-jp { color: var(--vermilion); opacity: 0.85; letter-spacing: 0; }
        .yx-line-no { font-family: var(--font-mono); font-size: var(--t-micro); color: var(--gray-500); letter-spacing: 0.14em; }
        .yx-line-head { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 13px 16px 8px; }
        .yx-line-q { font-size: var(--t-head); font-weight: 600; }
        .yx-line-q b { font-weight: 800; }
        .yx-line-cadwrap { display: inline-flex; align-items: center; gap: 7px; }
        .yx-line-cad { font-family: var(--font-mono); font-size: var(--t-micro); letter-spacing: 0.14em; color: var(--gray-500); text-transform: uppercase; }
        .yx-clock { font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--vermilion); }
        .yx-live-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--vermilion); animation: yx-pulse 1.8s var(--ease) infinite; }
        .yx-line-cadwrap[data-urgent] .yx-live-dot { animation-duration: 0.9s; }
        .yx-spark { position: relative; padding: 0 2px; }
        .yx-spark-path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: yx-draw 1100ms var(--ease) forwards; }
        .yx-spark-dot { position: absolute; right: 8px; width: 8px; height: 8px; border-radius: 999px; background: var(--profit); box-shadow: 0 0 12px 2px color-mix(in srgb, var(--profit) 55%, transparent); transform: translateY(-50%); animation: yx-dot 1.6s var(--ease) infinite; }
        .yx-winline { position: absolute; right: 16px; transform: translateY(-50%); font-family: var(--font-mono); font-size: var(--t-micro); letter-spacing: 0.08em; color: var(--vermilion); background: color-mix(in srgb, var(--bg) 82%, transparent); border: 1px solid color-mix(in srgb, var(--vermilion) 45%, transparent); border-radius: 5px; padding: 2px 7px; }
        .yx-odds { display: flex; gap: 18px; padding: 12px 16px 4px; }
        .yx-odd { display: flex; align-items: baseline; gap: 7px; }
        .yx-odd-lab { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: var(--t-label); color: var(--gray-500); }
        .yx-odd.up .yx-odd-lab svg { color: var(--profit); }
        .yx-odd.dn .yx-odd-lab svg { color: var(--loss); }
        .yx-odd-x { font-family: var(--font-mono); font-size: var(--t-head); font-weight: 800; letter-spacing: -0.01em; }
        .yx-odd.up .yx-odd-x { color: var(--profit); }
        .yx-odd.dn .yx-odd-x { color: var(--loss); }
        .yx-oddsbar { display: flex; height: 6px; border-radius: 999px; overflow: hidden; margin: 2px 16px 10px; background: var(--gray-900); }
        .yx-oddsbar i { transform: scaleX(0); transform-origin: left; animation: yx-bar 900ms var(--ease-out) 200ms forwards; }
        .yx-oddsbar .up { background: var(--profit); }
        .yx-oddsbar .dn { background: var(--loss); }
        .yx-reply2bet { display: flex; gap: 6px; margin: 4px 16px; padding: 10px; border-radius: 12px; background: color-mix(in srgb, var(--white) 3%, transparent); border: 1px solid color-mix(in srgb, var(--white) 6%, transparent); }
        .yx-connect-row { justify-content: center; }
        .yx-r2b-amt { flex: 1; display: flex; align-items: center; gap: 4px; background: color-mix(in srgb, var(--white) 4%, transparent); border: 1px solid var(--gray-800); border-radius: 999px; padding: 9px 15px; color: var(--gray-400); font-family: var(--font-mono); font-size: 13.5px; }
        .yx-r2b-amt input { background: none; border: none; outline: none; color: var(--white); font-family: var(--font-mono); font-size: 13.5px; width: 100%; }
        .yx-r2b { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 84px; border: none; border-radius: 999px; padding: 10px 16px; font-weight: 800; font-size: 13px; font-family: var(--font-mono); color: #06120c; box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 22%, transparent); transition: transform 90ms var(--ease), filter 140ms, box-shadow 160ms; }
        .yx-r2b.up { background: var(--profit); }
        .yx-r2b.dn { background: var(--loss); color: #1a0508; }
        .yx-r2b:hover:not(:disabled) { filter: brightness(1.07); }
        .yx-r2b.up:hover:not(:disabled) { box-shadow: 0 6px 22px -6px color-mix(in srgb, var(--profit) 60%, transparent); }
        .yx-r2b.dn:hover:not(:disabled) { box-shadow: 0 6px 22px -6px color-mix(in srgb, var(--loss) 60%, transparent); }
        .yx-r2b:active:not(:disabled) { transform: scale(0.94); }
        .yx-r2b:disabled { opacity: 0.55; cursor: default; }
        .yx-r2b:focus-visible { outline: 2px solid var(--white); outline-offset: 2px; }
        .yx-r2b-note { padding: 6px 16px 14px; font-size: 12px; color: var(--gray-500); line-height: 1.4; }
        .yx-connect :global(button) { width: 100%; }

        .yx-actions { display: flex; align-items: center; gap: 4px; padding: 6px 0 8px; max-width: 430px; }
        .yx-act { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; color: var(--gray-500); font-size: var(--t-meta); font-family: var(--font-mono); padding: 6px; border-radius: 999px; transition: color 130ms var(--ease), background 130ms var(--ease); flex: 1; justify-content: flex-start; }
        .yx-act.reply:hover { color: var(--vermilion); background: color-mix(in srgb, var(--vermilion) 12%, transparent); }
        .yx-act.repost:hover { color: var(--profit); background: color-mix(in srgb, var(--profit) 12%, transparent); }
        .yx-act.like:hover { color: var(--loss); background: color-mix(in srgb, var(--loss) 12%, transparent); }
        .yx-act.like:active svg { animation: yx-heart 320ms var(--ease-bounce); fill: var(--loss); }
        .yx-act.views:hover { color: var(--white); }
        .yx-act-end { display: inline-flex; gap: 2px; flex: none; }
        .yx-act-end .yx-act { flex: none; }
        .yx-feedempty { padding: 40px 16px; text-align: center; font-size: 14px; color: var(--gray-500); }
        .yx-feedempty b { color: var(--vermilion); font-weight: 700; }

        .yx-rail { padding: 8px 16px 40px; display: flex; flex-direction: column; gap: 16px; }
        .yx-search { position: sticky; top: 8px; display: flex; align-items: center; gap: 10px; background: var(--gray-950); border: 1px solid var(--gray-800); border-radius: 999px; padding: 11px 16px; color: var(--gray-500); }
        .yx-search input { background: none; border: none; outline: none; color: var(--white); font-size: var(--t-body); width: 100%; font-family: var(--font-display); }
        .yx-widget { background: color-mix(in srgb, var(--white) 3%, transparent); border: 1px solid var(--gray-800); border-radius: 16px; overflow: hidden; }
        .yx-widget h2 { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 800; padding: 16px 16px 10px; letter-spacing: -0.02em; line-height: 1.1; }
        .yx-widget-jp { margin-left: auto; font-size: 13px; color: var(--vermilion); opacity: 0.8; }
        .yx-livetag { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: 0.14em; color: var(--vermilion); }
        .yx-livetag i { width: 6px; height: 6px; border-radius: 999px; background: var(--vermilion); animation: yx-pulse 1.8s var(--ease) infinite; }
        .yx-mkt { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 16px; border: none; background: none; color: var(--white); text-align: left; transition: background 120ms var(--ease); }
        .yx-mkt:hover { background: color-mix(in srgb, var(--white) 4%, transparent); }
        .yx-mkt-no { font-family: var(--font-mono); font-size: var(--t-label); color: var(--vermilion); letter-spacing: 0.1em; flex: none; }
        .yx-mkt-q { font-size: var(--t-body); font-weight: 600; flex: 1; }
        .yx-mkt-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
        .yx-mkt-cad { font-family: var(--font-mono); font-size: var(--t-micro); color: var(--gray-500); letter-spacing: 0.14em; text-transform: uppercase; }
        .yx-mkt-pct { display: inline-flex; align-items: center; gap: 3px; font-family: var(--font-mono); font-size: var(--t-meta); font-weight: 700; }
        .yx-mkt-pct.up { color: var(--profit); }
        .yx-mkt-pct.dn { color: var(--loss); }
        .yx-mkt-empty { padding: 14px 16px; font-family: var(--font-mono); font-size: 12px; color: var(--gray-500); }
        .yx-more { width: 100%; text-align: left; padding: 12px 16px; border: none; background: none; color: var(--vermilion); font-size: var(--t-body); }
        .yx-more:hover { background: color-mix(in srgb, var(--white) 4%, transparent); }
        .yx-follow { display: flex; align-items: center; gap: 11px; padding: 10px 16px; transition: background 120ms var(--ease); }
        .yx-follow:hover { background: color-mix(in srgb, var(--white) 4%, transparent); }
        .yx-follow-id { display: flex; flex-direction: column; flex: 1; min-width: 0; line-height: 1.3; }
        .yx-follow-id b { font-size: var(--t-body); font-weight: 700; display: inline-flex; align-items: center; gap: 3px; }
        .yx-follow-id i { font-family: var(--font-mono); font-size: 12.5px; color: var(--gray-500); font-style: normal; }
        .yx-follow-id em { font-size: 11.5px; color: var(--gray-600); font-style: normal; margin-top: 1px; }
        .yx-follow-btn { flex: none; padding: 7px 16px; border-radius: 999px; border: 1px solid var(--gray-700); background: var(--white); color: var(--bg); font-weight: 700; font-size: 13.5px; transition: opacity 120ms var(--ease); }
        .yx-follow-btn:hover { opacity: 0.85; }
        .yx-legal { font-size: 11.5px; color: var(--gray-600); line-height: 1.5; padding: 0 4px; }

        @keyframes yx-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--vermilion) 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 7px transparent; } }
        @keyframes yx-draw { to { stroke-dashoffset: 0; } }
        @keyframes yx-bar { to { transform: scaleX(1); } }
        @keyframes yx-dot { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--profit) 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 8px transparent; } }
        @keyframes yx-heart { 0% { transform: scale(0.8); } 55% { transform: scale(1.25); } 100% { transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) {
          .yx-live-dot, .yx-spark-dot, .yx-spark-path, .yx-oddsbar i, .yx-livetag i, .yx-act.like:active svg { animation: none !important; stroke-dashoffset: 0 !important; }
          .yx-oddsbar i { transform: scaleX(1) !important; }
        }
        @media (max-width: 1100px) {
          .yx-root { grid-template-columns: 88px minmax(0, 600px) 300px; }
          .yx-navitem span, .yx-post-lg, .yx-me-id, .yx-me svg:last-child, .yx-brand-jp { display: none; }
          .yx-navitem { width: fit-content; }
          .yx-post-btn { width: 52px; height: 52px; padding: 0; display: grid; place-items: center; }
          .yx-post-sm { display: block; }
        }
      `}</style>
    </div>
  );
}

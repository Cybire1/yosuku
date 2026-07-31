'use client';

// /reels — "The Floor". Not a Twitter clone: a live prediction floor where the
// content is LINES (first-class market objects you answer by betting) and CALLS
// (people's takes you can tail or fade). Wired to the live 6-24 venue: real spot,
// strikes, odds, Pyth sparkline, ticking countdowns; reply-to-bet places a real,
// gasless, un-drainable bet via ticket624; the feed is real on-chain take_board.
// No borrowed engagement metrics (no likes / reposts / views) — the action IS the
// bet. Identity is the author address until you.yosuku names ship (next).

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
import { usePoll } from '@/lib/hooks/usePoll';
import {
  LayoutGrid, LineChart, Sparkle, Users, Wallet, User, Feather,
  BadgeCheck, TrendingUp, TrendingDown, MoreHorizontal, ArrowUpRight, Plus,
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
  { icon: LayoutGrid, label: 'The Floor', active: true, href: '/reels' },
  { icon: LineChart, label: 'Markets', href: '/markets' },
  { icon: Sparkle, label: 'Sensei', href: '/sensei' },
  { icon: Users, label: 'Circles', href: '/reels' },
  { icon: Wallet, label: 'Portfolio', href: '/portfolio' },
  { icon: User, label: 'Profile', href: '/reels' },
];

const usd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
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
const CAD = (c: string) => ({ '1m': '1-min', '5m': '5-min', '1h': '1-hour' }[c] ?? c);
const CADUP = (c: string) => ({ '1m': '1-MIN', '5m': '5-MIN', '1h': 'HOURLY' }[c] ?? c);

// Implied entry probability that BTC finishes above `line` (the word-market logistic).
function probAbove(spot: number, line: number, msLeft: number): number {
  const secs = Math.max(45, msLeft / 1000);
  const sigma = spot * 0.00028 * Math.sqrt(secs / 60);
  const z = (spot - line) / (sigma || 1);
  return Math.max(0.03, Math.min(0.97, 1 / (1 + Math.exp(-1.15 * z))));
}
const payoutX = (p: number) => Math.max(1.05, 1 / p);
const linesFor = (spot: number) => ({ up: Math.round(spot - BAND_USD), down: Math.round(spot + BAND_USD) });

// SVG sparkline (0..320 x, 0..72 y) from a price series + win-line.
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
  return { line: `M${pts.join(' L')}`, area: `M0 ${H} L${pts.join(' L')} L${W} ${H} Z`, dotY: Y(s[n - 1]), winY: line != null ? Y(line) : null };
}

function Avatar({ name, agent, size = 42 }: { name: string; agent?: boolean; size?: number }) {
  const initial = (name.replace(/^0x/, '')[0] ?? 'Y').toUpperCase();
  return (
    <span className="yx-av" style={{ width: size, height: size, fontSize: size * 0.4 }} data-agent={agent ? 'y' : undefined}>
      {agent ? <Mark size={size * 0.5} /> : initial}
    </span>
  );
}
function Verified({ agent }: { agent?: boolean }) {
  return <BadgeCheck size={15} className="yx-tick" data-agent={agent ? 'y' : undefined} />;
}

/* ── FEATURED LINE — the full standalone betting slip (a market, not a tweet) ── */
function LineSlip({ market, spot, series, now, connected, busy, onBet }: {
  market: Market624; spot: number; series: number[]; now: number;
  connected: boolean; busy: string | null; onBet: (dir: Dir, stake: number) => void;
}) {
  const [stake, setStake] = useState('5');
  const frozen = useRef<{ id: string; up: number; down: number } | null>(null);
  if (frozen.current?.id !== market.id) frozen.current = { id: market.id, up: Math.round(spot - BAND_USD), down: Math.round(spot + BAND_USD) };
  const upLine = frozen.current!.up, downLine = frozen.current!.down;
  const msLeft = now > 0 ? Math.max(0, market.expiry - now) : 0;
  const urgent = msLeft <= minMintMs(market.cadence);
  const probUp = probAbove(spot, upLine, msLeft);
  const probDown = 1 - probAbove(spot, downLine, msLeft);
  const g = sparkGeom(series, upLine);
  const stakeN = Math.max(0, Number(stake) || 0);
  const b = `slip-${market.id}`;

  return (
    <div className="yx-line">
      <span className="yx-line-kanji" aria-hidden>予</span>
      <div className="yx-line-brand">
        <span className="yx-line-mark"><Mark size={13} /> LINE <i className="yx-jp">予測</i></span>
        <span className="yx-line-no">OPEN · {CADUP(market.cadence)} · N° {market.id.slice(2, 8).toUpperCase()}</span>
      </div>
      <div className="yx-line-head">
        <span className="yx-line-q">BTC over <b>{usd0(upLine)}</b></span>
        <span className="yx-line-cadwrap" data-urgent={urgent ? 'y' : undefined}>
          <span className="yx-live-dot" /><span className="yx-line-cad">closes</span><span className="yx-clock">{mmss(msLeft)}</span>
        </span>
      </div>
      <div className="yx-spark">
        <svg viewBox="0 0 320 72" preserveAspectRatio="none" width="100%" height="72">
          <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--profit)" stopOpacity="0.26" /><stop offset="1" stopColor="var(--profit)" stopOpacity="0" /></linearGradient></defs>
          {g && (<><path d={g.area} fill="url(#lg)" /><path className="yx-spark-path" d={g.line} pathLength={1} fill="none" stroke="var(--profit)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />{g.winY != null && <line x1="0" y1={g.winY} x2="320" y2={g.winY} stroke="var(--vermilion)" strokeWidth="1.4" strokeDasharray="3 4" opacity="0.95" />}</>)}
        </svg>
        {g && <span className="yx-spark-dot" style={{ top: `${g.dotY}px` }} />}
        {g && g.winY != null && <span className="yx-winline" style={{ top: `${g.winY}px` }}>YOUR LINE · {usd0(upLine)}</span>}
      </div>
      <div className="yx-odds">
        <span className="yx-odd up"><span className="yx-odd-lab"><TrendingUp size={13} /> UP {Math.round(probUp * 100)}% · pays</span><span className="yx-odd-x">{payoutX(probUp).toFixed(2)}×</span></span>
        <span className="yx-odd dn"><span className="yx-odd-lab"><TrendingDown size={13} /> DOWN {Math.round(probDown * 100)}% · pays</span><span className="yx-odd-x">{payoutX(probDown).toFixed(2)}×</span></span>
      </div>
      <div className="yx-oddsbar"><i className="up" style={{ width: `${Math.round(probUp * 100)}%` }} /><i className="dn" style={{ width: `${Math.round(probDown * 100)}%` }} /></div>
      {connected ? (
        <div className="yx-reply2bet">
          <span className="yx-r2b-amt"><span>$</span><input value={stake} onChange={(e) => setStake(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" aria-label="Stake in DUSDC" /></span>
          <button className="yx-r2b up" disabled={busy === b || stakeN <= 0} onClick={() => onBet('up', stakeN)}>{busy === b ? '…' : <><TrendingUp size={13} /> Answer UP</>}</button>
          <button className="yx-r2b dn" disabled={busy === b || stakeN <= 0} onClick={() => onBet('down', stakeN)}>{busy === b ? '…' : <><TrendingDown size={13} /> Answer DOWN</>}</button>
        </div>
      ) : (
        <div className="yx-reply2bet yx-connect-row"><span className="yx-connect"><ConnectButton connectText="Connect a wallet to answer" /></span></div>
      )}
      <div className="yx-r2b-note">Answering IS your bet. UP wins above {usd0(upLine)}, DOWN below {usd0(downLine)}. Settled by the oracle, gas-free, paid straight to your wallet.</div>
    </div>
  );
}

/* ── COMPACT LINE — a stacked open line, quick-answer $5 ── */
function LineRow({ market, spot, now, connected, busy, onBet }: {
  market: Market624; spot: number; now: number; connected: boolean; busy: string | null; onBet: (dir: Dir, stake: number) => void;
}) {
  const { up, down } = linesFor(spot);
  const msLeft = now > 0 ? Math.max(0, market.expiry - now) : 0;
  const urgent = msLeft <= minMintMs(market.cadence);
  const probUp = probAbove(spot, up, msLeft);
  const probDown = 1 - probAbove(spot, down, msLeft);
  const b = `row-${market.id}`;
  return (
    <div className="yx-linerow">
      <div className="yx-lr-l">
        <span className="yx-lr-q">BTC over <b>{usd0(up)}</b></span>
        <span className="yx-lr-meta" data-urgent={urgent ? 'y' : undefined}><span className="yx-live-dot" />{CAD(market.cadence)} · closes {mmss(msLeft)}</span>
      </div>
      <div className="yx-lr-odds"><span className="pays">pays {payoutX(probUp).toFixed(2)}×</span></div>
      {connected ? (
        <div className="yx-lr-act">
          <button className="yx-r2b up sm" disabled={busy === b} onClick={() => onBet('up', 5)}>{busy === b ? '…' : 'UP'}</button>
          <button className="yx-r2b dn sm" disabled={busy === b} onClick={() => onBet('down', 5)}>{busy === b ? '…' : 'DOWN'}</button>
        </div>
      ) : <span className="yx-lr-locked">connect</span>}
    </div>
  );
}

/* ── CALL — a person's take, backed by a position; tail it or fade it ── */
function CallCard({ take, live, connected, busy, onTailFade }: {
  take: FeedTake; live: boolean; connected: boolean; busy: string | null; onTailFade: (t: FeedTake, dir: Dir, stake: number) => void;
}) {
  const tailDir: Dir = take.side === 1 ? 'down' : 'up';
  const fadeDir: Dir = tailDir === 'up' ? 'down' : 'up';
  const body = take.caption?.trim() || `Called ${take.side === 1 ? 'DOWN' : take.side === 2 ? 'a range' : 'UP'} on BTC${take.strikeUsd ? ` at ${usd0(take.strikeUsd)}` : ''}.`;
  const b = `call-${take.blobId}`;
  return (
    <article className="yx-call">
      <Avatar name={take.author} />
      <div className="yx-call-body">
        <div className="yx-post-head">
          <b>{shortName(take.author)}</b>
          <span className="yx-side" data-dir={tailDir}>{take.side === 1 ? 'DOWN' : take.side === 2 ? 'RANGE' : 'UP'}</span>
          <span className="yx-dot">·</span><span className="yx-time">{timeAgo(take.tsMs)}</span>
          {take.digest && <a className="yx-verifylink" href={`https://suiscan.xyz/testnet/tx/${take.digest}`} target="_blank" rel="noreferrer">verify <ArrowUpRight size={11} /></a>}
        </div>
        <div className="yx-post-text">{body}</div>
        <div className="yx-call-foot">
          {take.backed && <span className="yx-backed"><BadgeCheck size={13} /> real position{take.stakeDusdc ? ` · $${take.stakeDusdc.toFixed(2)}` : ''}</span>}
          {live && connected && (
            <span className="yx-tailfade">
              <button className="yx-tail" disabled={busy === b} onClick={() => onTailFade(take, tailDir, 5)}>{busy === b ? '…' : 'Tail'}</button>
              <button className="yx-fade" disabled={busy === b} onClick={() => onTailFade(take, fadeDir, 5)}>Fade</button>
            </span>
          )}
          {live && !connected && <span className="yx-lr-locked">connect to tail</span>}
          {!live && <span className="yx-closed">line closed</span>}
        </div>
      </div>
    </article>
  );
}

export default function ReelsFeed() {
  const account = useCurrentAccount();
  const { toast } = useToast();
  const { submit } = useSmartSubmit();
  const acct = useAccount624();

  const [tab, setTab] = useState<'lines' | 'calls'>('lines');
  const [composerOpen, setComposerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);

  const [markets, setMarkets] = useState<Market624[]>([]);
  const [spot, setSpot] = useState<number | null>(null);
  const [series, setSeries] = useState<number[]>([]);
  const [takes, setTakes] = useState<FeedTake[]>([]);
  const reloadTakes = useMemo(() => () => { fetchTakes(30).then(setTakes).catch(() => {}); }, []);
  // visibility-aware: a backgrounded reel used to keep pulling markets/spot/tape/takes forever
  usePoll(() => { fetchMarkets624().then(setMarkets).catch(() => {}); }, 15000);
  usePoll(() => { fetchSpot624().then((s) => setSpot(Math.round(s))).catch(() => {}); }, 6000);
  usePoll(() => { fetchPythHistory624(150).then((h) => { if (h.length > 5) setSeries(h.map((x) => x.usd)); }).catch(() => {}); }, 20000);
  usePoll(reloadTakes, 25000);

  const liveSeries = useMemo(() => (spot != null && series.length > 1 ? [...series, spot] : series), [series, spot]);
  const rounds = useMemo(() => {
    const t = now || Date.now();
    return markets.filter((m) => m.expiry - t > minMintMs(m.cadence) * 0.6).sort((a, b) => a.expiry - b.expiry);
  }, [markets, now]);
  const featured = rounds[0] ?? null;
  const moreLines = rounds.slice(1, 5);

  async function place(market: Market624, dir: Dir, stake: number, tag: string) {
    if (!account?.address || spot == null || busy || stake <= 0) return;
    setBusy(tag);
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
  const tailFade = (t: FeedTake, dir: Dir, stake: number) => {
    const m = markets.find((x) => x.id === t.marketId);
    if (m) place(m, dir, stake, `call-${t.blobId}`);
    else toast('That line has closed.', 'error');
  };

  return (
    <div className="yx-root">
      {/* LEFT NAV */}
      <aside className="yx-nav">
        <div className="yx-brand"><Mark size={32} /><i className="yx-jp yx-brand-jp">予測</i></div>
        <nav className="yx-navlist">
          {NAV.map((n) => (
            <a key={n.label} href={n.href} className={`yx-navitem ${n.active ? 'on' : ''}`}>
              <n.icon size={23} strokeWidth={n.active ? 2.3 : 1.9} /><span>{n.label}</span>
            </a>
          ))}
        </nav>
        <button className="yx-post-btn" onClick={() => setComposerOpen(true)}><span className="yx-post-lg">Post a call</span><Feather size={22} className="yx-post-sm" /></button>
        {account ? (
          <button className="yx-me">
            <Avatar name={account.address} size={38} />
            <span className="yx-me-id"><b>{shortName(account.address)} <Verified /></b><i><span className="yx-me-key">claim your name</span></i></span>
            <MoreHorizontal size={17} />
          </button>
        ) : <span className="yx-me-connect"><ConnectButton connectText="Connect wallet" /></span>}
      </aside>

      {/* CENTER — THE FLOOR */}
      <main className="yx-feed">
        <header className="yx-feedhead">
          <div className="yx-floor-title">
            <h1><Mark size={17} /> The Floor</h1>
            <span className="yx-floor-live"><span className="yx-live-dot" />{rounds.length} {rounds.length === 1 ? 'line' : 'lines'} open</span>
          </div>
          <div className="yx-tabs">
            <button className={tab === 'lines' ? 'on' : ''} onClick={() => setTab('lines')}>Lines</button>
            <button className={tab === 'calls' ? 'on' : ''} onClick={() => setTab('calls')}>Calls</button>
          </div>
        </header>

        {tab === 'lines' ? (
          <>
            {featured && spot != null
              ? <div className="yx-feat"><LineSlip market={featured} spot={spot} series={liveSeries} now={now} connected={!!account} busy={busy} onBet={(dir, stake) => place(featured, dir, stake, `slip-${featured.id}`)} /></div>
              : <div className="yx-line yx-line-empty">{spot == null ? 'Reading the market…' : 'Between lines. A new one opens every minute.'}</div>}
            {moreLines.length > 0 && spot != null && (
              <div className="yx-moresec">
                <div className="yx-sec-h">More open lines <span>quick answer · $5</span></div>
                {moreLines.map((m) => <LineRow key={m.id} market={m} spot={spot} now={now} connected={!!account} busy={busy} onBet={(dir, stake) => place(m, dir, stake, `row-${m.id}`)} />)}
              </div>
            )}
            {takes.slice(0, 3).map((t) => <CallCard key={`${t.blobId}-${t.tsMs}`} take={t} live={markets.some((m) => m.id === t.marketId && m.expiry - now > 0)} connected={!!account} busy={busy} onTailFade={tailFade} />)}
          </>
        ) : (
          <>
            {takes.length ? takes.map((t) => <CallCard key={`${t.blobId}-${t.tsMs}`} take={t} live={markets.some((m) => m.id === t.marketId && m.expiry - now > 0)} connected={!!account} busy={busy} onTailFade={tailFade} />)
              : <div className="yx-feedempty">No calls yet. Make one, tap <b>Post a call</b> and back it with a real bet.</div>}
          </>
        )}
      </main>

      {/* RIGHT — CLOSING NOW board + Sensei */}
      <aside className="yx-rail">
        <section className="yx-widget">
          <h2>Closing now <span className="yx-livetag"><i />LIVE</span></h2>
          {rounds.length && spot != null ? rounds.slice(0, 6).map((m) => {
            const { up } = linesFor(spot);
            const msLeft = Math.max(0, m.expiry - (now || Date.now()));
            const urgent = msLeft <= minMintMs(m.cadence);
            return (
              <button key={m.id} className="yx-close-row" onClick={() => setTab('lines')}>
                <span className="yx-close-cad">{CADUP(m.cadence)}</span>
                <span className="yx-close-q">BTC over {usd0(up)}</span>
                <span className={`yx-close-t ${urgent ? 'urgent' : ''}`}>{mmss(msLeft)}</span>
              </button>
            );
          }) : <div className="yx-mkt-empty">Between rounds…</div>}
        </section>

        <a className="yx-sensei" href="/sensei">
          <Avatar name="Sensei" agent size={40} />
          <span className="yx-sensei-txt"><b>Sensei</b><i>Get your read before you answer a line. It even tells you when to sit out.</i></span>
          <ArrowUpRight size={16} />
        </a>

        <a className="yx-cta" href="#" onClick={(e) => { e.preventDefault(); setComposerOpen(true); }}>
          <Plus size={16} /> Post a call, backed by a real bet
        </a>

        <p className="yx-legal">Every call is on-chain. Every bet, gas-free and un-drainable. yosuku.xyz · testnet</p>
      </aside>

      {composerOpen && <TakeComposer624 onClose={() => setComposerOpen(false)} onPosted={reloadTakes} />}

      <style jsx global>{`
        .yx-root {
          --t-head: 17px; --t-body: 15px; --t-meta: 13px; --t-label: 11px; --t-micro: 10px;
          --jp: var(--font-noto-serif-jp), 'Noto Serif JP', serif;
          display: grid; grid-template-columns: 250px minmax(0, 604px) 340px;
          max-width: 1194px; margin: 0 auto; min-height: 100vh;
          color: var(--white); font-family: var(--font-display);
        }
        .yx-root button, .yx-root a { cursor: pointer; font-family: inherit; }
        .yx-root a { text-decoration: none; color: inherit; }
        .yx-jp { font-family: var(--jp); font-style: normal; }
        .yx-clock, .yx-line-cad, .yx-odd-x, .yx-winline, .yx-r2b, .yx-r2b-amt, .yx-backed,
        .yx-lr-odds, .yx-lr-meta, .yx-close-t, .yx-close-cad, .yx-side, .yx-line-no {
          font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
        }

        /* LEFT NAV */
        .yx-nav { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; align-items: flex-start; padding: 10px; gap: 4px; border-right: 1px solid var(--gray-800); }
        .yx-brand { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 10px 12px 8px; color: var(--white); }
        .yx-brand-jp { font-size: var(--t-label); color: var(--vermilion); letter-spacing: 0.28em; opacity: 0.85; padding-left: 0.28em; }
        .yx-navlist { display: flex; flex-direction: column; gap: 2px; width: 100%; }
        .yx-navitem { display: flex; align-items: center; gap: 15px; padding: 11px 16px; border-radius: 999px; color: var(--white); font-size: 18px; transition: background 140ms var(--ease); width: fit-content; }
        .yx-navitem span { padding-right: 6px; }
        .yx-navitem:hover { background: color-mix(in srgb, var(--white) 8%, transparent); }
        .yx-navitem.on { font-weight: 700; }
        .yx-navitem.on svg { color: var(--vermilion); }
        .yx-post-btn { margin: 16px 0 0; width: 100%; padding: 14px 0; background: var(--vermilion); color: #fff; border: none; border-radius: 999px; font-size: 15.5px; font-weight: 700; box-shadow: 0 10px 26px -14px color-mix(in srgb, var(--vermilion) 45%, transparent); transition: transform 120ms var(--ease), background 140ms var(--ease); }
        .yx-post-btn:hover { background: var(--vermilion-d); transform: translateY(-1px); }
        .yx-post-sm { display: none; }
        .yx-me { margin-top: auto; margin-bottom: 6px; display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; border: none; background: none; border-radius: 999px; color: var(--white); text-align: left; transition: background 140ms var(--ease); }
        .yx-me:hover { background: color-mix(in srgb, var(--white) 7%, transparent); }
        .yx-me-id { display: flex; flex-direction: column; line-height: 1.3; flex: 1; min-width: 0; }
        .yx-me-id b { font-size: 13.5px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px; font-family: var(--font-mono); }
        .yx-me-id i { font-size: 12px; color: color-mix(in srgb, var(--vermilion) 72%, var(--gray-400)); font-style: normal; font-family: var(--font-mono); }
        .yx-me-connect { margin-top: auto; margin-bottom: 10px; width: 100%; }

        .yx-av { flex: none; display: grid; place-items: center; border-radius: 999px; background: linear-gradient(150deg, var(--gray-700), var(--gray-900)); color: var(--white); font-weight: 700; border: 1px solid var(--gray-800); }
        .yx-av[data-agent] { background: linear-gradient(150deg, color-mix(in srgb, var(--vermilion) 30%, var(--gray-900)), var(--gray-950)); border-color: color-mix(in srgb, var(--vermilion) 40%, transparent); color: var(--vermilion); }
        .yx-tick { color: var(--gray-400); flex: none; }
        .yx-tick[data-agent] { color: var(--vermilion); }

        /* CENTER */
        .yx-feed { border-right: 1px solid var(--gray-800); min-height: 100vh; }
        .yx-feedhead { position: sticky; top: 0; z-index: 5; backdrop-filter: blur(12px); background: color-mix(in srgb, var(--bg) 74%, transparent); border-bottom: 1px solid var(--gray-800); }
        .yx-floor-title { display: flex; align-items: center; justify-content: space-between; padding: 13px 18px 8px; }
        .yx-floor-title h1 { display: flex; align-items: center; gap: 8px; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
        .yx-floor-live { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: var(--t-label); letter-spacing: 0.08em; text-transform: uppercase; color: var(--gray-400); }
        .yx-tabs { display: flex; gap: 4px; padding: 0 12px; }
        .yx-tabs button { position: relative; padding: 12px 16px; border: none; background: none; color: var(--gray-500); font-size: var(--t-body); font-weight: 600; transition: color 140ms var(--ease); }
        .yx-tabs button:hover { color: var(--gray-300); }
        .yx-tabs button.on { color: var(--white); font-weight: 700; }
        .yx-tabs button.on::after { content: ''; position: absolute; bottom: 0; left: 16px; right: 16px; height: 3px; border-radius: 3px; background: var(--vermilion); }

        .yx-feat { padding: 14px 16px 4px; }
        .yx-post-text { font-size: var(--t-body); line-height: 1.45; margin: 3px 0 2px; color: var(--gray-100); }
        .yx-post-text b { color: var(--white); font-weight: 700; }
        .yx-post-head { display: flex; align-items: center; gap: 6px; font-size: var(--t-body); }
        .yx-post-head b { font-weight: 700; }
        .yx-dot, .yx-time { color: var(--gray-500); font-weight: 400; }
        .yx-verifylink { margin-left: auto; display: inline-flex; align-items: center; gap: 2px; font-family: var(--font-mono); font-size: var(--t-micro); color: var(--gray-500); text-transform: uppercase; letter-spacing: 0.1em; }
        .yx-verifylink:hover { color: var(--vermilion); }

        /* LINE slip */
        .yx-line { position: relative; border-radius: 16px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--vermilion) 22%, var(--gray-800)); background: color-mix(in srgb, var(--white) 4.5%, var(--bg)); box-shadow: inset 0 1px 0 color-mix(in srgb, var(--white) 7%, transparent), 0 20px 46px -22px rgba(0,0,0,0.85); }
        .yx-line-empty { margin: 14px 16px; padding: 34px 16px; text-align: center; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.06em; color: var(--gray-500); }
        .yx-line-kanji { position: absolute; top: -14px; right: 6px; font-family: var(--jp); font-size: 96px; line-height: 1; color: var(--vermilion); opacity: 0.06; pointer-events: none; }
        .yx-line-brand { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 11px 16px; border-bottom: 1px dashed color-mix(in srgb, var(--gray-800) 80%, transparent); }
        .yx-line-mark { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; font-size: 12px; letter-spacing: 0.14em; color: var(--gray-400); }
        .yx-line-mark .yx-jp { color: var(--vermilion); opacity: 0.85; letter-spacing: 0; }
        .yx-line-no { font-family: var(--font-mono); font-size: var(--t-micro); color: var(--gray-500); letter-spacing: 0.1em; }
        .yx-line-head { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 13px 16px 8px; }
        .yx-line-q { font-size: var(--t-head); font-weight: 600; }
        .yx-line-q b { font-weight: 800; }
        .yx-line-cadwrap { display: inline-flex; align-items: center; gap: 7px; }
        .yx-line-cad { font-family: var(--font-mono); font-size: var(--t-micro); letter-spacing: 0.14em; color: var(--gray-500); text-transform: uppercase; }
        .yx-clock { font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--vermilion); }
        .yx-live-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--vermilion); animation: yx-pulse 1.8s var(--ease) infinite; flex: none; }
        .yx-line-cadwrap[data-urgent] .yx-live-dot { animation-duration: 0.9s; }
        .yx-spark { position: relative; padding: 0 2px; }
        .yx-spark-path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: yx-draw 1100ms var(--ease) forwards; }
        .yx-spark-dot { position: absolute; right: 8px; width: 8px; height: 8px; border-radius: 999px; background: var(--profit); box-shadow: 0 0 12px 2px color-mix(in srgb, var(--profit) 55%, transparent); transform: translateY(-50%); animation: yx-dot 1.6s var(--ease) infinite; }
        .yx-winline { position: absolute; right: 16px; transform: translateY(-50%); font-family: var(--font-mono); font-size: var(--t-micro); letter-spacing: 0.08em; color: var(--vermilion); background: color-mix(in srgb, var(--bg) 82%, transparent); border: 1px solid color-mix(in srgb, var(--vermilion) 45%, transparent); border-radius: 5px; padding: 2px 7px; }
        .yx-odds { display: flex; gap: 18px; padding: 12px 16px 4px; }
        .yx-odd { display: flex; align-items: baseline; gap: 7px; }
        .yx-odd-lab { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: var(--t-label); color: var(--gray-500); }
        .yx-odd.up .yx-odd-lab svg { color: var(--profit); } .yx-odd.dn .yx-odd-lab svg { color: var(--loss); }
        .yx-odd-x { font-family: var(--font-mono); font-size: var(--t-head); font-weight: 800; letter-spacing: -0.01em; }
        .yx-odd.up .yx-odd-x { color: var(--profit); } .yx-odd.dn .yx-odd-x { color: var(--loss); }
        .yx-oddsbar { display: flex; height: 6px; border-radius: 999px; overflow: hidden; margin: 2px 16px 10px; background: var(--gray-900); }
        .yx-oddsbar i { transform: scaleX(0); transform-origin: left; animation: yx-bar 900ms var(--ease-out) 200ms forwards; }
        .yx-oddsbar .up { background: var(--profit); } .yx-oddsbar .dn { background: var(--loss); }
        .yx-reply2bet { display: flex; gap: 6px; margin: 4px 16px; padding: 10px; border-radius: 12px; background: color-mix(in srgb, var(--white) 3%, transparent); border: 1px solid color-mix(in srgb, var(--white) 6%, transparent); }
        .yx-connect-row { justify-content: center; }
        .yx-r2b-amt { flex: none; width: 74px; display: flex; align-items: center; gap: 3px; background: color-mix(in srgb, var(--white) 4%, transparent); border: 1px solid var(--gray-800); border-radius: 999px; padding: 9px 13px; color: var(--gray-400); font-family: var(--font-mono); font-size: 13.5px; }
        .yx-r2b-amt input { background: none; border: none; outline: none; color: var(--white); font-family: var(--font-mono); font-size: 13.5px; width: 100%; }
        .yx-r2b { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: none; border-radius: 999px; padding: 10px 12px; font-weight: 800; font-size: 12.5px; font-family: var(--font-mono); color: #06120c; box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 22%, transparent); transition: transform 90ms var(--ease), filter 140ms, box-shadow 160ms; }
        .yx-r2b.up { background: var(--profit); } .yx-r2b.dn { background: var(--loss); color: #1a0508; }
        .yx-r2b.sm { flex: none; min-width: 56px; padding: 7px 12px; font-size: 12px; }
        .yx-r2b:hover:not(:disabled) { filter: brightness(1.07); }
        .yx-r2b.up:hover:not(:disabled) { box-shadow: 0 6px 22px -6px color-mix(in srgb, var(--profit) 60%, transparent); }
        .yx-r2b.dn:hover:not(:disabled) { box-shadow: 0 6px 22px -6px color-mix(in srgb, var(--loss) 60%, transparent); }
        .yx-r2b:active:not(:disabled) { transform: scale(0.94); }
        .yx-r2b:disabled { opacity: 0.55; cursor: default; }
        .yx-r2b-note { padding: 6px 16px 14px; font-size: 12px; color: var(--gray-500); line-height: 1.4; }
        .yx-connect :global(button) { width: 100%; }

        /* MORE LINES */
        .yx-moresec { padding: 16px 16px 4px; }
        .yx-sec-h { display: flex; align-items: baseline; justify-content: space-between; padding: 4px 2px 8px; font-size: var(--t-meta); font-weight: 700; color: var(--gray-300); }
        .yx-sec-h span { font-family: var(--font-mono); font-size: var(--t-micro); letter-spacing: 0.1em; text-transform: uppercase; color: var(--gray-500); font-weight: 400; }
        .yx-linerow { display: flex; align-items: center; gap: 12px; padding: 11px 4px; border-bottom: 1px solid color-mix(in srgb, var(--gray-800) 55%, transparent); }
        .yx-lr-l { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .yx-lr-q { font-size: var(--t-body); font-weight: 600; } .yx-lr-q b { font-weight: 800; }
        .yx-lr-meta { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: var(--t-micro); letter-spacing: 0.06em; text-transform: uppercase; color: var(--gray-500); }
        .yx-lr-meta[data-urgent] { color: color-mix(in srgb, var(--vermilion) 80%, var(--gray-400)); }
        .yx-lr-odds { font-family: var(--font-mono); font-size: var(--t-meta); font-weight: 700; color: var(--gray-300); flex: none; }
        .yx-lr-odds .pays { font-variant-numeric: tabular-nums; }
        .yx-lr-act { display: inline-flex; gap: 5px; flex: none; }
        .yx-lr-locked { font-family: var(--font-mono); font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.1em; color: var(--gray-600); }

        /* CALLS */
        .yx-call { display: flex; gap: 12px; padding: 14px 16px; border-bottom: 1px solid color-mix(in srgb, var(--gray-800) 55%, transparent); transition: background 120ms var(--ease); }
        .yx-call:hover { background: color-mix(in srgb, var(--white) 2.5%, transparent); }
        .yx-call-body { flex: 1; min-width: 0; }
        .yx-side { font-family: var(--font-mono); font-size: var(--t-micro); font-weight: 700; letter-spacing: 0.1em; padding: 2px 7px; border-radius: 999px; }
        .yx-side[data-dir="up"] { color: var(--profit); border: 1px solid color-mix(in srgb, var(--profit) 34%, transparent); }
        .yx-side[data-dir="down"] { color: var(--loss); border: 1px solid color-mix(in srgb, var(--loss) 34%, transparent); }
        .yx-call-foot { display: flex; align-items: center; gap: 10px; margin-top: 9px; flex-wrap: wrap; }
        .yx-backed { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: 11.5px; color: var(--profit); background: color-mix(in srgb, var(--profit) 10%, transparent); border: 1px solid color-mix(in srgb, var(--profit) 28%, transparent); padding: 4px 9px; border-radius: 8px; }
        .yx-tailfade { display: inline-flex; gap: 6px; }
        .yx-tail, .yx-fade { font-family: var(--font-display); font-size: 12.5px; font-weight: 700; padding: 6px 15px; border-radius: 999px; transition: all 130ms var(--ease); }
        .yx-tail { background: color-mix(in srgb, var(--profit) 16%, transparent); color: var(--profit); border: 1px solid color-mix(in srgb, var(--profit) 40%, transparent); }
        .yx-tail:hover:not(:disabled) { background: color-mix(in srgb, var(--profit) 26%, transparent); }
        .yx-fade { background: none; color: var(--gray-400); border: 1px solid var(--gray-700); }
        .yx-fade:hover:not(:disabled) { color: var(--loss); border-color: color-mix(in srgb, var(--loss) 45%, transparent); }
        .yx-tail:disabled, .yx-fade:disabled { opacity: 0.55; }
        .yx-closed { font-family: var(--font-mono); font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.1em; color: var(--gray-600); }
        .yx-feedempty { padding: 48px 24px; text-align: center; font-size: 14.5px; color: var(--gray-500); line-height: 1.5; }
        .yx-feedempty b { color: var(--vermilion); font-weight: 700; }

        /* RIGHT — CLOSING NOW + Sensei */
        .yx-rail { padding: 14px 16px 40px; display: flex; flex-direction: column; gap: 14px; }
        .yx-widget { background: color-mix(in srgb, var(--white) 3%, transparent); border: 1px solid var(--gray-800); border-radius: 16px; overflow: hidden; }
        .yx-widget h2 { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 800; padding: 15px 16px 8px; letter-spacing: -0.02em; }
        .yx-livetag { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: 0.14em; color: var(--vermilion); }
        .yx-livetag i { width: 6px; height: 6px; border-radius: 999px; background: var(--vermilion); animation: yx-pulse 1.8s var(--ease) infinite; }
        .yx-close-row { display: flex; align-items: center; gap: 11px; width: 100%; padding: 10px 16px; border: none; background: none; color: var(--white); text-align: left; transition: background 120ms var(--ease); }
        .yx-close-row:hover { background: color-mix(in srgb, var(--white) 4%, transparent); }
        .yx-close-cad { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.12em; color: var(--vermilion); width: 42px; flex: none; }
        .yx-close-q { flex: 1; font-size: var(--t-meta); font-weight: 600; }
        .yx-close-t { font-family: var(--font-mono); font-size: var(--t-meta); font-weight: 700; color: var(--gray-400); }
        .yx-close-t.urgent { color: var(--vermilion); }
        .yx-mkt-empty { padding: 14px 16px; font-family: var(--font-mono); font-size: 12px; color: var(--gray-500); }
        .yx-sensei { display: flex; align-items: center; gap: 11px; padding: 14px; background: linear-gradient(150deg, color-mix(in srgb, var(--vermilion) 9%, var(--gray-950)), var(--gray-950)); border: 1px solid color-mix(in srgb, var(--vermilion) 22%, var(--gray-800)); border-radius: 16px; transition: border-color 140ms var(--ease); }
        .yx-sensei:hover { border-color: color-mix(in srgb, var(--vermilion) 45%, transparent); }
        .yx-sensei-txt { flex: 1; display: flex; flex-direction: column; gap: 2px; }
        .yx-sensei-txt b { font-size: 14.5px; font-weight: 800; }
        .yx-sensei-txt i { font-style: normal; font-size: 12px; color: var(--gray-400); line-height: 1.4; }
        .yx-sensei svg:last-child { color: var(--vermilion); flex: none; }
        .yx-cta { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 12px; border: 1px dashed var(--gray-700); border-radius: 14px; font-size: 13.5px; font-weight: 600; color: var(--gray-300); transition: all 140ms var(--ease); }
        .yx-cta:hover { border-color: color-mix(in srgb, var(--vermilion) 50%, transparent); color: var(--white); }
        .yx-cta svg { color: var(--vermilion); }
        .yx-legal { font-size: 11px; color: var(--gray-600); line-height: 1.5; padding: 2px 4px; }

        @keyframes yx-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--vermilion) 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 7px transparent; } }
        @keyframes yx-draw { to { stroke-dashoffset: 0; } }
        @keyframes yx-bar { to { transform: scaleX(1); } }
        @keyframes yx-dot { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--profit) 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 8px transparent; } }
        @media (prefers-reduced-motion: reduce) {
          .yx-live-dot, .yx-spark-dot, .yx-spark-path, .yx-oddsbar i, .yx-livetag i { animation: none !important; stroke-dashoffset: 0 !important; }
          .yx-oddsbar i { transform: scaleX(1) !important; }
        }
        @media (max-width: 1080px) {
          .yx-root { grid-template-columns: 80px minmax(0, 604px) 300px; }
          .yx-navitem span, .yx-post-lg, .yx-me-id, .yx-me svg:last-child, .yx-brand-jp { display: none; }
          .yx-navitem { width: fit-content; }
          .yx-post-btn { width: 48px; height: 48px; padding: 0; display: grid; place-items: center; }
          .yx-post-sm { display: block; }
        }
      `}</style>
    </div>
  );
}

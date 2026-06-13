'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import SectionHeader from '@/components/SectionHeader';
import { drawCandles, priceHistoryToCandles } from '@/lib/charts/canvasChart';
import { useLeaderboard, usePriceHistory, useOracles } from '@/lib/sui/hooks';
import { formatAddress } from '@/lib/leaderboardStats';

// Deterministic color disc from an address — a clean identity avatar (no text,
// no hex-dump, no collisions). Two close hues give the disc a little depth.
function avatarGradient(addr: string): string {
  let hash = 0;
  for (let i = 0; i < addr.length; i++) hash = ((hash << 5) - hash + addr.charCodeAt(i)) | 0;
  const h = Math.abs(hash) % 360;
  return `linear-gradient(140deg, hsl(${h} 40% 22%) 0%, hsl(${(h + 26) % 360} 58% 47%) 100%)`;
}

function fmtPnl(v: number) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function LeaderboardPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [period, setPeriod] = useState('week');
  const [asset, setAsset] = useState('all');
  const yokoChartRef = useRef<HTMLCanvasElement>(null);

  const { data: leaderboard, loading: lbLoading } = useLeaderboard();
  const { active: liveOracles } = useOracles();

  const rankings = leaderboard?.rankings ?? [];
  const meta = leaderboard?.meta ?? { totalWallets: 0, totalVolume: 0 };
  const records = leaderboard?.records ?? [];

  // Top 3 for podium
  const podiumData = useMemo(() => {
    if (rankings.length < 3) return rankings.map((t, i) => ({ ...t, r: i + 1 }));
    // Reorder: [2nd, 1st, 3rd] for podium display
    return [
      { ...rankings[1], r: 2 },
      { ...rankings[0], r: 1 },
      { ...rankings[2], r: 3 },
    ];
  }, [rankings]);


  // Yokozuna chart — use real price history if top trader exists
  const topTrader = rankings[0];
  // We don't have the trader's most-traded oracle, so we use the first active oracle's price history
  const { history: yokoHistory } = usePriceHistory(null, 60);

  useEffect(() => {
    if (!yokoChartRef.current) return;
    if (yokoHistory.length > 5) {
      const candles = priceHistoryToCandles(yokoHistory, 60);
      if (candles.length > 0) {
        const mid = candles[Math.floor(candles.length / 2)];
        drawCandles(yokoChartRef.current, candles, {
          strike: mid.close,
          maxCandleW: 6,
          gridLines: true,
          marker: true,
          padX: 32,
          padTop: 22,
          padBot: 22,
        });
        return;
      }
    }
    // Fallback: empty chart with placeholder
    const { ctx, w, h } = { ctx: yokoChartRef.current.getContext('2d'), w: yokoChartRef.current.clientWidth, h: yokoChartRef.current.clientHeight };
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Chart data loading...', w / 2, h / 2);
    }
  }, [yokoHistory]);

  // Next seal countdown — derived from nearest oracle expiry
  const [sealTime, setSealTime] = useState(0);
  useEffect(() => {
    const tick = () => {
      const upcoming = liveOracles.filter(o => o.expiry > Date.now());
      if (upcoming.length > 0) {
        const nearest = Math.min(...upcoming.map(o => o.expiry));
        setSealTime(Math.max(0, Math.floor((nearest - Date.now()) / 1000)));
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [liveOracles]);
  const sealH = Math.floor(sealTime / 3600);
  const sealM = Math.floor((sealTime % 3600) / 60);
  const sealS = sealTime % 60;
  const sealStr = `${String(sealH).padStart(2, '0')}:${String(sealM).padStart(2, '0')}:${String(sealS).padStart(2, '0')}`;

  // Find connected wallet's rank
  const userRankData = useMemo(() => {
    if (!address || rankings.length === 0) return null;
    const idx = rankings.findIndex(r => r.owner === address);
    if (idx === -1) return null;
    return { rank: idx + 1, trader: rankings[idx] };
  }, [address, rankings]);

  const PERIODS = [
    { key: 'day', label: 'Today' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'all', label: 'All time' },
  ];
  const ASSETS = [
    { key: 'all', label: 'All', glyph: '' },
    { key: 'btc', label: 'BTC', glyph: '\u20BF' },
    { key: 'eth', label: 'ETH', glyph: '\u039E' },
    { key: 'sol', label: 'SOL', glyph: '\u25CE' },
    { key: 'sui', label: 'SUI', glyph: 'S' },
  ];

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <GrainOverlay />

      {/* Hero */}
      <section className="container">
        <div className="lb-hero">
          <div className="lb-hero-grid">
            <div>
              <div className="lb-hero-eyebrow">
                <span className="dash" />
                <span>The ranking sheet</span>
                <span className="vermilion">— sealed nightly · 16:00 UTC</span>
              </div>
              <h1 className="lb-hero-title">
                The<br />
                <span className="vermilion">house</span><br />
                of names.
              </h1>
              <p className="lb-hero-sub">
                {meta.totalWallets > 0
                  ? `${meta.totalWallets.toLocaleString()} wallets called the bell this season. These are the ones the bell answered.`
                  : 'Loading rankings from on-chain trade data...'}
                {' '}Ranks calculated on net realized P&L, sealed at every daily cut.
              </p>
            </div>
            <div className="lb-meta-col">
              <div>
                <div>Wallets ranked</div>
                <div className="big">{meta.totalWallets > 0 ? meta.totalWallets.toLocaleString() : '\u2014'}</div>
              </div>
              <div>
                <div>Volume settled · season</div>
                <div className="big">{meta.totalVolume > 0 ? `$${meta.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '\u2014'}</div>
              </div>
              <div>
                <div>Next reseal in</div>
                <div className="big">{sealStr}</div>
              </div>
              <div className="stamp">
                SEASON №04
                <div style={{ marginTop: 4, fontSize: '8px' }}>2026 Q2</div>
              </div>
            </div>
          </div>

          {/* Filter bar */}
          <div className="lb-filter-bar">
            <div className="pill-tabs">
              {PERIODS.map(p => (
                <button
                  key={p.key}
                  className={`pill-tab ${period === p.key ? 'active' : ''}`}
                  onClick={() => setPeriod(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="asset-tabs">
              {ASSETS.map(a => (
                <button
                  key={a.key}
                  className={`asset-tab ${asset === a.key ? 'active' : ''}`}
                  onClick={() => setAsset(a.key)}
                >
                  {a.glyph && <span className="glyph">{a.glyph}</span>}
                  {a.label}
                </button>
              ))}
            </div>
            <div className="lb-filter-meta">{meta.totalWallets > 0 ? `${meta.totalWallets.toLocaleString()} wallets` : '\u2014'}</div>
          </div>
        </div>
      </section>

      <main>
        <div className="container">

          {/* Loading state */}
          {lbLoading && (
            <div style={{ textAlign: 'center', padding: '64px 0', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
              Loading rankings from on-chain data...
            </div>
          )}

          {/* Section 1: Podium */}
          {podiumData.length > 0 && (
            <section>
              <SectionHeader
                number="01"
                title="The podium"
                desc="Top three traders by net realized P&L this season."
                meta="live · re-ranks every cut"
              />

              <div className="podium">
                {podiumData.map(p => (
                  <div key={p.r} className={`podium-spot s${p.r}`} data-cursor="hover">
                    <span className="podium-rank">{p.r}</span>
                    {p.r === 1 && <span className="sash">GRAND CHAMPION</span>}
                    <div className="podium-eyebrow">
                      <span className="ord">{p.r === 1 ? '1ST' : p.r === 2 ? '2ND' : '3RD'}</span>
                      <span>{p.r === 1 ? `GRAND CHAMPION · ${p.bestStreak} CUTS` : p.r === 2 ? 'CHALLENGER' : 'CONTENDER'}</span>
                    </div>
                    <div className="podium-portrait" style={{ background: avatarGradient(p.owner) }} />
                    <div className="podium-name">{fmtAddr(p.owner)}</div>
                    <div className="podium-handle">{fmtAddr(p.owner)}</div>
                    <div className="podium-pnl">
                      <span className="sign">{p.pnl >= 0 ? '+' : ''}</span>{fmtPnl(p.pnl)}<span className="cur">DUSDC</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Section 2: Yokozuna */}
          {topTrader && (
            <section>
              <SectionHeader
                number="02"
                title="Grand champion"
                desc={`Top trader with ${topTrader.bestStreak} consecutive winning cuts.`}
                meta="current season"
              />

              <div className="yokozuna">
                <div className="yoko-left">
                  <div className="yoko-eyebrow"><span className="dot" />Reigning · {topTrader.bestStreak} cuts best streak</div>
                  <h3 className="yoko-name">{fmtAddr(topTrader.owner)}</h3>
                  <div className="yoko-meta">BEST STREAK <span className="v">{topTrader.bestStreak}</span> · WIN RATE <span className="v">{topTrader.winRate}%</span></div>
                  <p className="yoko-quote">
                    &ldquo;The bell decides.&rdquo;
                  </p>
                  <div className="yoko-stats">
                    <div className="item"><div className="lbl">Net P&L</div><div className="val up">{topTrader.pnl >= 0 ? '+' : ''}{fmtPnl(topTrader.pnl)}</div></div>
                    <div className="item"><div className="lbl">Win rate</div><div className="val">{topTrader.winRate}%</div></div>
                    <div className="item"><div className="lbl">Streak</div><div className="val">{topTrader.bestStreak}</div></div>
                    <div className="item"><div className="lbl">Rounds</div><div className="val">{topTrader.tradeCount}</div></div>
                  </div>
                </div>
                <div className="yoko-right">
                  <div className="head">
                    <h4>Season performance</h4>
                    <span className="meta">price chart</span>
                  </div>
                  <div className="yoko-chart">
                    <span className="crop-tl" /><span className="crop-tr" /><span className="crop-bl" /><span className="crop-br" />
                    <canvas ref={yokoChartRef} />
                  </div>
                  <div className="yoko-replay-foot">
                    <span>VOLUME <span className="stake">{topTrader.volume.toLocaleString('en-US', { maximumFractionDigits: 0 })} DUSDC</span></span>
                    <span>TRADES <span className="stake">{topTrader.tradeCount}</span></span>
                    <span>NET <span style={{ color: 'var(--vermilion)' }}>{topTrader.pnl >= 0 ? '+' : ''}{fmtPnl(topTrader.pnl)}</span></span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Section 3: Ranking sheet */}
          {rankings.length > 0 && (
            <section>
              <SectionHeader
                number="03"
                title="Ranking sheet"
                desc="Every trader this season, ordered by net realized P&L."
                meta={`${rankings.length} ranked`}
              />

              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.01] overflow-hidden">
                {/* column header */}
                <div className="hidden sm:grid grid-cols-[56px_1fr_150px_140px] gap-4 px-5 py-3 border-b border-white/[0.06] font-mono text-[10px] uppercase tracking-[0.14em] text-gray-600">
                  <span>Rank</span>
                  <span>Trader</span>
                  <span className="text-right">Win · rounds</span>
                  <span className="text-right">Net P&amp;L</span>
                </div>
                {rankings.slice(0, 50).map((t, i) => {
                  const rank = i + 1;
                  const me = address ? t.owner === address : false;
                  return (
                    <div
                      key={t.owner}
                      data-cursor="hover"
                      className={`grid grid-cols-[40px_1fr_auto] sm:grid-cols-[56px_1fr_150px_140px] gap-4 items-center px-5 py-3 border-b border-white/[0.04] last:border-0 transition-colors ${me ? 'bg-vermilion/[0.07]' : 'hover:bg-white/[0.02]'}`}
                    >
                      <span className={`font-mono font-bold tabular-nums ${rank <= 3 ? 'text-vermilion text-base' : 'text-gray-500 text-sm'}`}>{rank}</span>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-9 h-9 rounded-full flex-shrink-0 border border-white/10" style={{ background: avatarGradient(t.owner) }} />
                        <span className="font-mono text-sm text-white truncate">
                          {fmtAddr(t.owner)}{me && <span className="text-vermilion"> · you</span>}
                        </span>
                      </div>
                      <span className="hidden sm:block font-mono text-xs text-gray-500 text-right tabular-nums">
                        {t.winRate}% · {t.tradeCount}
                      </span>
                      <span className={`font-mono text-sm font-semibold text-right tabular-nums ${t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {t.pnl >= 0 ? '+' : ''}{fmtPnl(t.pnl)} <span className="text-gray-600 text-[10px]">DUSDC</span>
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* You bar */}
              {address && (
                <div className="you-bar" data-cursor="hover">
                  <div className="you-rank">
                    <span className="lbl">Your rank</span>
                    <span>
                      <span className="val">{userRankData ? `#${userRankData.rank}` : 'Unranked'}</span>
                      <span className="of">of {meta.totalWallets > 0 ? meta.totalWallets.toLocaleString() : '\u2014'}</span>
                    </span>
                  </div>
                  <div className="you-info">
                    <div className="you-portrait" style={{ background: avatarGradient(address) }} />
                    <div className="you-text">
                      <span className="name">You · {formatAddress(address)}</span>
                      <span className="meta">{userRankData ? `top ${Math.round((userRankData.rank / Math.max(1, meta.totalWallets)) * 100)}%` : 'no trades yet'}</span>
                    </div>
                  </div>
                  <div className="you-stats">
                    <div className="item"><span className="lbl">Net</span><span className="v">{userRankData ? `${userRankData.trader.pnl >= 0 ? '+' : ''}${fmtPnl(userRankData.trader.pnl)}` : '\u2014'}</span></div>
                    <div className="item"><span className="lbl">Win rate</span><span className="v">{userRankData ? `${userRankData.trader.winRate}%` : '\u2014'}</span></div>
                    <div className="item"><span className="lbl">Streak</span><span className="v">{userRankData ? String(userRankData.trader.bestStreak).padStart(2, '0') : '\u2014'}</span></div>
                  </div>
                  <a className="you-cta" href="/portfolio">Your ledger →</a>
                </div>
              )}
            </section>
          )}

          {/* Section 4: Records */}
          {records.length > 0 && (
            <section>
              <SectionHeader
                number="04"
                title="Records of the season"
                desc="The cuts the floor will remember."
                meta="season №04 · sealed"
              />

              <div className="records-grid">
                {records.map((rec, i) => {
                  return (
                    <div key={i} className="record" data-cursor="hover">
                      <div className="ghost">{String(i + 1).padStart(2, '0')}</div>
                      <div className="head">
                        <span className="lbl">{rec.label}</span>
                        <span className="badge">{rec.badge}</span>
                      </div>
                      <div className="num">{rec.value}<span className="unit">{rec.unit}</span></div>
                      <div className="desc">{rec.desc}</div>
                      <div className="by">
                        <span className="av" style={{ background: avatarGradient(rec.trader) }} />
                        <span>by <span className="name">{fmtAddr(rec.trader)}</span> · {rec.date}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

        </div>
      </main>

      <Footer />
    </div>
  );
}

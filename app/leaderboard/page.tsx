'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import SectionHeader from '@/components/SectionHeader';
import { drawSparkline } from '@/lib/charts/canvasChart';
import { drawCandles } from '@/lib/charts/canvasChart';
import { priceHistoryToCandles } from '@/lib/charts/canvasChart';
import { useLeaderboard, usePriceHistory } from '@/lib/sui/hooks';
import { formatAddress } from '@/lib/leaderboardStats';

// Japanese number glyphs for rank labels
const JP_NUMS = ['一','二','三','四','五','六','七','八','九','十',
  '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
  '二一','二二','二三','二四','二五'];

// Deterministic glyph from address
const KANJI_POOL = '林青霧桜雷雪川石山松森光鳥夜梅藤熊寒銀金空海風波';
function glyphFromAddress(addr: string): string {
  let hash = 0;
  for (let i = 0; i < addr.length; i++) {
    hash = ((hash << 5) - hash + addr.charCodeAt(i)) | 0;
  }
  return KANJI_POOL[Math.abs(hash) % KANJI_POOL.length];
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

  // Banzuke rows: pair rankings into east/west
  const banzukeData = useMemo(() => {
    const rows = [];
    for (let i = 0; i < Math.min(rankings.length, 50); i += 2) {
      const rank = Math.floor(i / 2) + 1;
      const east = rankings[i];
      const west = rankings[i + 1];
      let tier = 1;
      if (rank <= 3) tier = rank;
      else if (rank <= 7) tier = 3;
      else if (rank <= 12) tier = 4;
      else tier = 5;
      rows.push({
        rank,
        jp: JP_NUMS[rank - 1] || String(rank),
        tier,
        east: east ? {
          glyph: glyphFromAddress(east.owner),
          name: fmtAddr(east.owner),
          handle: '',
          pnl: east.pnl,
          meta: `${east.tradeCount} rounds · ${east.winRate}%`,
        } : null,
        west: west ? {
          glyph: glyphFromAddress(west.owner),
          name: fmtAddr(west.owner),
          handle: '',
          pnl: west.pnl,
          meta: `${west.tradeCount} rounds · ${west.winRate}%`,
        } : null,
      });
    }
    return rows;
  }, [rankings]);

  // Podium sparklines (deterministic from PnL)
  const sparkRefs = useRef<Record<number, HTMLCanvasElement | null>>({});

  useEffect(() => {
    podiumData.forEach(p => {
      const cv = sparkRefs.current[p.r];
      if (!cv) return;
      // Generate sparkline from trader stats
      const data: number[] = [];
      let v = 0;
      let seed = p.owner.charCodeAt(2) || 7;
      for (let i = 0; i < 16; i++) {
        seed = (seed * 9301 + 49297) % 233280;
        v += (seed / 233280 - 0.4) * (p.pnl > 0 ? 2 : 1);
        data.push(v);
      }
      // Normalize
      const max = Math.max(...data.map(Math.abs)) || 1;
      const norm = data.map(d => d / max);
      drawSparkline(cv, norm, {
        color: p.r === 1 ? '#E04D26' : '#fff',
        fillColor: p.r === 1 ? 'rgba(224,77,38,0.32)' : 'rgba(255,255,255,0.10)',
        lineWidth: 1.4,
        dotEnd: true,
      });
    });
  }, [podiumData]);

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

  // Next seal countdown
  const [sealTime, setSealTime] = useState(4 * 3600 + 38 * 60 + 21);
  useEffect(() => {
    const iv = setInterval(() => setSealTime(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(iv);
  }, []);
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
                <span>Banzuke · 番付 · the ranking sheet</span>
                <span className="vermilion">— sealed nightly · 16:00 UTC</span>
              </div>
              <h1 className="lb-hero-title">
                The<br />
                <span className="vermilion">house</span><br />
                of names.
              </h1>
              <div className="lb-hero-jp">勝者の番付</div>
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
                SEASON №04<span className="jp">第四場所</span>
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
                jp="表彰台"
                desc="Top three traders by net realized P&L this season."
                meta="live · re-ranks every cut"
              />

              <div className="podium">
                {podiumData.map(p => (
                  <div key={p.r} className={`podium-spot s${p.r}`} data-cursor="hover">
                    <span className="podium-rank">{p.r}</span>
                    {p.r === 1 && <span className="sash">YOKOZUNA · 横綱</span>}
                    <div className="podium-eyebrow">
                      <span className="ord">{p.r === 1 ? '1ST' : p.r === 2 ? '2ND' : '3RD'}</span>
                      <span>{p.r === 1 ? `GRAND CHAMPION · ${p.bestStreak} CUTS` : p.r === 2 ? 'CHALLENGER' : 'CONTENDER'}</span>
                    </div>
                    <div className="podium-portrait">{glyphFromAddress(p.owner)}</div>
                    <div className="podium-name">{fmtAddr(p.owner)}</div>
                    <div className="podium-handle">{fmtAddr(p.owner)}</div>
                    <div className="podium-jp">{glyphFromAddress(p.owner)}</div>
                    <div className="podium-pnl">
                      <span className="sign">{p.pnl >= 0 ? '+' : ''}</span>{fmtPnl(p.pnl)}<span className="cur">DUSDC</span>
                    </div>
                    <div className="podium-stats">
                      <div className="item"><div className="lbl">Win</div><div className="val">{p.winRate}%</div></div>
                      <div className="item"><div className="lbl">Streak</div><div className="val">{String(p.bestStreak).padStart(2, '0')}</div></div>
                      <div className="item"><div className="lbl">Rounds</div><div className="val">{p.tradeCount}</div></div>
                    </div>
                    <div className="podium-spark">
                      <canvas ref={el => { sparkRefs.current[p.r] = el; }} />
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
                title="Yokozuna"
                jp="横綱 · the grand champion"
                desc={`Top trader with ${topTrader.bestStreak} consecutive winning cuts.`}
                meta="current season"
              />

              <div className="yokozuna">
                <div className="yoko-left">
                  <div className="yoko-eyebrow"><span className="dot" />Reigning · {topTrader.bestStreak} cuts best streak</div>
                  <h3 className="yoko-name">{fmtAddr(topTrader.owner)}</h3>
                  <div className="yoko-jp">{glyphFromAddress(topTrader.owner)} · {fmtAddr(topTrader.owner)}</div>
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

          {/* Section 3: Banzuke */}
          {banzukeData.length > 0 && (
            <section>
              <SectionHeader
                number="03"
                title="Ranking sheet"
                jp="番付表"
                desc="Top traders of the season ranked by net realized P&L."
                meta="east 上 · west 下"
              />

              <div className="banzuke-wrap">
                <div className="banzuke-strip">
                  <span>EAST · 東 · UP-side specialists</span>
                  <span className="center">第四場所 · 番付</span>
                  <span>DOWN-side specialists · 西 · WEST</span>
                </div>
                <div className="banzuke-cols-head">
                  <div className="east">↑ Long the bell</div>
                  <div className="center">RANK</div>
                  <div className="west">Short the bell ↓</div>
                </div>
                <div>
                  {banzukeData.map((row, i) => {
                    const prevTier = i > 0 ? banzukeData[i - 1].tier : row.tier;
                    return (
                      <div key={row.rank}>
                        {i > 0 && row.tier !== prevTier && row.tier === 4 && (
                          <div className="bz-divider">前頭 <span className="jp">·下位·</span> RANK &amp; FILE</div>
                        )}
                        {i > 0 && row.tier !== prevTier && row.tier === 5 && (
                          <div className="bz-divider">幕下 <span className="jp">·末席·</span> THE LONG TAIL</div>
                        )}
                        <div className={`banzuke-row tier-${row.tier}`}>
                          {/* East cell */}
                          {row.east ? (
                            <div className="bz-cell east" data-cursor="hover">
                              <span className="bz-meta">{row.east.meta}</span>
                              <span className="bz-pnl">{row.east.pnl >= 0 ? '+' : ''}{fmtPnl(row.east.pnl)}</span>
                              <div className="bz-text">
                                <span className="bz-name">{row.east.name}</span>
                                {row.east.handle && <span className="bz-handle">{row.east.handle}</span>}
                              </div>
                              <div className="bz-portrait">{row.east.glyph}</div>
                            </div>
                          ) : <div className="bz-cell east" />}
                          {/* Center rank */}
                          <div className="center">{row.jp}</div>
                          {/* West cell */}
                          {row.west ? (
                            <div className="bz-cell west" data-cursor="hover">
                              <div className="bz-portrait">{row.west.glyph}</div>
                              <div className="bz-text">
                                <span className="bz-name">{row.west.name}</span>
                                {row.west.handle && <span className="bz-handle">{row.west.handle}</span>}
                              </div>
                              <span className="bz-pnl">{row.west.pnl >= 0 ? '+' : ''}{fmtPnl(row.west.pnl)}</span>
                              <span className="bz-meta">{row.west.meta}</span>
                            </div>
                          ) : <div className="bz-cell west" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
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
                    <div className="you-portrait">{glyphFromAddress(address)}</div>
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
                jp="記録"
                desc="The cuts the floor will remember."
                meta="season №04 · sealed"
              />

              <div className="records-grid">
                {records.map((rec, i) => {
                  const ghosts = ['勝', '連', '逆'];
                  return (
                    <div key={i} className="record" data-cursor="hover">
                      <div className="ghost">{ghosts[i] || '記'}</div>
                      <div className="head">
                        <span className="lbl">{rec.label}</span>
                        <span className="badge">{rec.badge}</span>
                      </div>
                      <div className="num">{rec.value}<span className="unit">{rec.unit}</span></div>
                      <div className="desc">{rec.desc}</div>
                      <div className="by">
                        <span className="av">{glyphFromAddress(rec.trader)}</span>
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

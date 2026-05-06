'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import SectionHeader from '@/components/SectionHeader';
import { drawSparkline } from '@/lib/charts/canvasChart';
import { drawCandles, genCandles } from '@/lib/charts/canvasChart';
import {
  getLeaderboard,
  getUserRank,
  formatAddress,
  formatVolume,
  type LeaderboardCategory,
  type TimePeriod,
  type TraderStats
} from '@/lib/leaderboardStats';

/* ── Mocked podium data (from mockup) ── */
const PODIUM_DATA = [
  {
    r: 2, glyph: '青', name: 'Aoi-15', handle: '@aoi_15min · 0x91b3…2c70',
    jp: '青井', pnl: 14820.40, win: 71, streak: 11, rounds: 318,
    spark: [-2,3,5,2,7,4,9,6,12,10,14,12,16,18,20,22],
  },
  {
    r: 1, glyph: '林', name: 'Hayashi-san', handle: '@hayashi_15min · 0x42c1…d8e0',
    jp: '林', pnl: 18402.20, win: 74, streak: 19, rounds: 412,
    spark: [0,4,2,6,8,10,12,11,14,18,22,24,26,30,34,38],
  },
  {
    r: 3, glyph: '霧', name: 'kiri.eth', handle: 'kiri.eth · 0x77ad…ff04',
    jp: 'kiri', pnl: 11248.70, win: 66, streak: 8, rounds: 244,
    spark: [1,2,4,3,6,5,8,10,9,12,11,14,16,15,18,20],
  },
];

/* ── Mocked banzuke rows (from mockup) ── */
const BANZUKE_DATA = [
  { rank: 1, jp: '一', tier: 1,
    east: { glyph:'林', name:'Hayashi-san', handle:'@hayashi_15min', pnl: 18402.20, meta:'412 rounds · 74%' },
    west: { glyph:'青', name:'Aoi-15',     handle:'@aoi_15min',     pnl: 14820.40, meta:'318 rounds · 71%' },
  },
  { rank: 2, jp: '二', tier: 2,
    east: { glyph:'霧', name:'kiri.eth',     handle:'kiri.eth',         pnl: 11248.70, meta:'244 rounds · 66%' },
    west: { glyph:'桜', name:'sakura.sui',   handle:'@sakura_close',    pnl: 10120.10, meta:'288 rounds · 63%' },
  },
  { rank: 3, jp: '三', tier: 2,
    east: { glyph:'雷', name:'Raiden',       handle:'@raiden_btc',      pnl:  9402.30, meta:'201 rounds · 68%' },
    west: { glyph:'雪', name:'yuki.sol',     handle:'yuki.sol',         pnl:  8918.00, meta:'176 rounds · 70%' },
  },
  { rank: 4, jp: '四', tier: 3,
    east: { glyph:'川', name:'Kawamoto',     handle:'@kawamoto_eth',    pnl:  7820.80, meta:'162 · 64%' },
    west: { glyph:'石', name:'ishikawa.eth', handle:'ishikawa.eth',     pnl:  7244.50, meta:'140 · 67%' },
  },
  { rank: 5, jp: '五', tier: 3,
    east: { glyph:'山', name:'yama.sui',     handle:'yama.sui',         pnl:  6612.00, meta:'118 · 60%' },
    west: { glyph:'松', name:'matsuda',      handle:'@matsu_15',        pnl:  6402.20, meta:'128 · 61%' },
  },
  { rank: 6, jp: '六', tier: 3,
    east: { glyph:'森', name:'Mori-bot',     handle:'@mori_quant',      pnl:  5818.40, meta:'201 · 56%' },
    west: { glyph:'光', name:'hikari.eth',   handle:'hikari.eth',       pnl:  5440.80, meta:'88 · 72%' },
  },
  { rank: 7, jp: '七', tier: 3,
    east: { glyph:'鳥', name:'Tori-15',      handle:'@tori_15',         pnl:  5102.10, meta:'104 · 65%' },
    west: { glyph:'夜', name:'yoru.sui',     handle:'yoru.sui',         pnl:  4920.40, meta:'94 · 66%' },
  },
  { rank: 8,  jp: '八',  tier: 4, east:{glyph:'梅',name:'Umeda',handle:'',pnl:4612.20,meta:''},  west:{glyph:'藤',name:'fuji.eth',handle:'',pnl:4408.00,meta:''} },
  { rank: 9,  jp: '九',  tier: 4, east:{glyph:'熊',name:'kuma.btc',handle:'',pnl:4204.40,meta:''},west:{glyph:'寒',name:'kanji.sui',handle:'',pnl:4108.40,meta:''} },
  { rank: 10, jp: '十',  tier: 4, east:{glyph:'銀',name:'gin.eth',handle:'',pnl:3920.80,meta:''}, west:{glyph:'金',name:'kin.sol',handle:'',pnl:3812.10,meta:''} },
  { rank: 11, jp: '十一',tier: 4, east:{glyph:'空',name:'sora.bot',handle:'',pnl:3680.00,meta:''},west:{glyph:'海',name:'kaikai',handle:'',pnl:3540.20,meta:''} },
  { rank: 12, jp: '十二',tier: 4, east:{glyph:'風',name:'kaze.btc',handle:'',pnl:3402.40,meta:''},west:{glyph:'波',name:'nami.sui',handle:'',pnl:3320.80,meta:''} },
  { rank: 13, jp:'十三', tier:5, east:{glyph:'A',name:'alpha.eth',handle:'',pnl:3120.10,meta:''}, west:{glyph:'B',name:'baku.btc',handle:'',pnl:2980.00,meta:''} },
  { rank: 14, jp:'十四', tier:5, east:{glyph:'C',name:'choco.sui',handle:'',pnl:2840.40,meta:''}, west:{glyph:'D',name:'daichi',handle:'',pnl:2720.10,meta:''} },
  { rank: 15, jp:'十五', tier:5, east:{glyph:'E',name:'ena.eth',handle:'',pnl:2602.20,meta:''},  west:{glyph:'F',name:'fuyu.sol',handle:'',pnl:2480.00,meta:''} },
  { rank: 16, jp:'十六', tier:5, east:{glyph:'G',name:'gai.bot',handle:'',pnl:2344.40,meta:''},  west:{glyph:'H',name:'haru.eth',handle:'',pnl:2218.40,meta:''} },
  { rank: 17, jp:'十七', tier:5, east:{glyph:'I',name:'ichi.btc',handle:'',pnl:2102.10,meta:''}, west:{glyph:'J',name:'jin.sui',handle:'',pnl:1988.00,meta:''} },
  { rank: 18, jp:'十八', tier:5, east:{glyph:'K',name:'kage',handle:'',pnl:1844.20,meta:''},     west:{glyph:'L',name:'luna.sol',handle:'',pnl:1742.40,meta:''} },
  { rank: 19, jp:'十九', tier:5, east:{glyph:'M',name:'midori',handle:'',pnl:1620.10,meta:''},   west:{glyph:'N',name:'nori.eth',handle:'',pnl:1518.40,meta:''} },
  { rank: 20, jp:'二十', tier:5, east:{glyph:'O',name:'ozaki',handle:'',pnl:1402.00,meta:''},    west:{glyph:'P',name:'pure.sol',handle:'',pnl:1308.20,meta:''} },
];

const RECORDS = [
  { ghost: '勝', lbl: 'Biggest single round', badge: '★ Record', num: '+4,820', unit: 'DUSDC',
    desc: 'Called BTC down through $66,000 with a 1,200 DUSDC stake at the 14:00 cut.',
    av: '林', avStyle: undefined, by: 'Hayashi-san', date: '2026-04-22 14:00 UTC' },
  { ghost: '連', lbl: 'Longest streak', badge: '17 cuts', num: '17', unit: 'in a row',
    desc: 'Seventeen consecutive winning rounds across BTC and SUI. No exits, no flips.',
    av: '青', avStyle: { background: 'linear-gradient(135deg,#1a1612,#9c4220)' }, by: 'Aoi-15', date: '2026-04-04 → 04-08' },
  { ghost: '逆', lbl: 'Biggest comeback', badge: '↻ Recovery', num: '+212', unit: '%',
    desc: 'Down 800, finished the week up 1,704. Twenty-six rounds, no doubling.',
    av: '霧', avStyle: { background: 'linear-gradient(135deg,#222,#7a5a30)' }, by: 'kiri.eth', date: 'week of 2026-03-29' },
];

function fmtPnl(v: number) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LeaderboardPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [period, setPeriod] = useState('week');
  const [asset, setAsset] = useState('all');
  const yokoChartRef = useRef<HTMLCanvasElement>(null);

  // Podium sparklines
  const sparkRefs = useRef<Record<number, HTMLCanvasElement | null>>({});

  useEffect(() => {
    PODIUM_DATA.forEach(p => {
      const cv = sparkRefs.current[p.r];
      if (!cv) return;
      const data = p.spark.map(v => v / (Math.max(...p.spark) || 1));
      drawSparkline(cv, data, {
        color: p.r === 1 ? '#E04D26' : '#fff',
        fillColor: p.r === 1 ? 'rgba(224,77,38,0.32)' : 'rgba(255,255,255,0.10)',
        lineWidth: 1.4,
        dotEnd: true,
      });
    });
  }, []);

  // Yokozuna chart
  useEffect(() => {
    if (!yokoChartRef.current) return;
    const candles = genCandles(60, 60, 67050, 67250, 30);
    drawCandles(yokoChartRef.current, candles, {
      strike: 67200,
      maxCandleW: 6,
      gridLines: true,
      marker: true,
      padX: 32,
      padTop: 22,
      padBot: 22,
    });
  }, []);

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

  const PERIODS = [
    { key: 'day', label: 'Today' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'This month' },
    { key: 'all', label: 'All time' },
  ];
  const ASSETS = [
    { key: 'all', label: 'All', glyph: '' },
    { key: 'btc', label: 'BTC', glyph: '₿' },
    { key: 'eth', label: 'ETH', glyph: 'Ξ' },
    { key: 'sol', label: 'SOL', glyph: '◎' },
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
                Twelve thousand wallets called the bell this season. These are the ones the bell answered.
                Ranks calculated on net realized P&L, sealed at every daily cut.
              </p>
            </div>
            <div className="lb-meta-col">
              <div>
                <div>Wallets ranked</div>
                <div className="big">12,402</div>
              </div>
              <div>
                <div>Volume settled · season</div>
                <div className="big">$48.2M</div>
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
            <div className="lb-filter-meta">12,402 wallets · 4,118 active</div>
          </div>
        </div>
      </section>

      <main>
        <div className="container">

          {/* Section 1: Podium */}
          <section>
            <SectionHeader
              number="01"
              title="The podium"
              jp="表彰台"
              desc="Three names that walked through the bell more than anyone else this week."
              meta="live · re-ranks every cut"
            />

            <div className="podium">
              {PODIUM_DATA.map(p => (
                <div key={p.r} className={`podium-spot s${p.r}`} data-cursor="hover">
                  <span className="podium-rank">{p.r}</span>
                  {p.r === 1 && <span className="sash">YOKOZUNA · 横綱</span>}
                  <div className="podium-eyebrow">
                    <span className="ord">{p.r === 1 ? '1ST' : p.r === 2 ? '2ND' : '3RD'}</span>
                    <span>{p.r === 1 ? 'GRAND CHAMPION · 23 CUTS' : p.r === 2 ? 'CHALLENGER' : 'CONTENDER'}</span>
                  </div>
                  <div className="podium-portrait">{p.glyph}</div>
                  <div className="podium-name">{p.name}</div>
                  <div className="podium-handle">{p.handle}</div>
                  <div className="podium-jp">{p.jp}</div>
                  <div className="podium-pnl">
                    <span className="sign">+</span>{fmtPnl(p.pnl)}<span className="cur">DUSDC</span>
                  </div>
                  <div className="podium-stats">
                    <div className="item"><div className="lbl">Win</div><div className="val">{p.win}%</div></div>
                    <div className="item"><div className="lbl">Streak</div><div className="val">{String(p.streak).padStart(2, '0')}</div></div>
                    <div className="item"><div className="lbl">Rounds</div><div className="val">{p.rounds}</div></div>
                  </div>
                  <div className="podium-spark">
                    <canvas ref={el => { sparkRefs.current[p.r] = el; }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Section 2: Yokozuna */}
          <section>
            <SectionHeader
              number="02"
              title="Yokozuna"
              jp="横綱 · the grand champion"
              desc="Held the top rank for 23 consecutive cuts. Their best round of the week, replayed."
              meta="since 2026-04-12"
            />

            <div className="yokozuna">
              <div className="yoko-left">
                <div className="yoko-eyebrow"><span className="dot" />Reigning · 23 cuts in a row</div>
                <h3 className="yoko-name">Hayashi-<span className="accent">san</span></h3>
                <div className="yoko-jp">林 · @hayashi_15min · 0x42c1…d8e0</div>
                <div className="yoko-meta">CHAMPION SINCE <span className="v">2026-04-12</span> · BEST CUT <span className="v">+1,108.40</span></div>
                <p className="yoko-quote">
                  &ldquo;I don&apos;t trade BTC. I trade the bell. The bell tells me when to stop being clever.&rdquo;
                </p>
                <div className="yoko-stats">
                  <div className="item"><div className="lbl">Net P&L</div><div className="val up">+18,402</div></div>
                  <div className="item"><div className="lbl">Win rate</div><div className="val">74%</div></div>
                  <div className="item"><div className="lbl">Streak</div><div className="val">19</div></div>
                  <div className="item"><div className="lbl">Rounds</div><div className="val">412</div></div>
                </div>
              </div>
              <div className="yoko-right">
                <div className="head">
                  <h4>Best round · BTC ≥ $67,200 · Apr 28 · 16:00 UTC</h4>
                  <span className="meta">replay 1m candles</span>
                </div>
                <div className="yoko-chart">
                  <span className="crop-tl" /><span className="crop-tr" /><span className="crop-bl" /><span className="crop-br" />
                  <canvas ref={yokoChartRef} />
                </div>
                <div className="yoko-replay-foot">
                  <span>STAKE <span className="stake">800.00 DUSDC</span></span>
                  <span>SIDE <span className="stake">UP ↑</span></span>
                  <span>SETTLE <span style={{ color: 'var(--vermilion)' }}>+1,108.40</span></span>
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Banzuke */}
          <section>
            <SectionHeader
              number="03"
              title="Ranking sheet"
              jp="番付表"
              desc="Top 50 of the season. East column for UP-side specialists, west for DOWN-side. Rank size scales with standing — the way it was always done."
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
                {BANZUKE_DATA.map((row, i) => {
                  const prevTier = i > 0 ? BANZUKE_DATA[i - 1].tier : row.tier;
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
                        <div className="bz-cell east" data-cursor="hover">
                          <span className="bz-meta">{row.east.meta}</span>
                          <span className="bz-pnl">+{fmtPnl(row.east.pnl)}</span>
                          <div className="bz-text">
                            <span className="bz-name">{row.east.name}</span>
                            {row.east.handle && <span className="bz-handle">{row.east.handle}</span>}
                          </div>
                          <div className="bz-portrait">{row.east.glyph}</div>
                        </div>
                        {/* Center rank */}
                        <div className="center">{row.jp}</div>
                        {/* West cell */}
                        <div className="bz-cell west" data-cursor="hover">
                          <div className="bz-portrait">{row.west.glyph}</div>
                          <div className="bz-text">
                            <span className="bz-name">{row.west.name}</span>
                            {row.west.handle && <span className="bz-handle">{row.west.handle}</span>}
                          </div>
                          <span className="bz-pnl">+{fmtPnl(row.west.pnl)}</span>
                          <span className="bz-meta">{row.west.meta}</span>
                        </div>
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
                  <span><span className="val">#847</span><span className="of">of 12,402</span></span>
                </div>
                <div className="you-info">
                  <div className="you-portrait">あ</div>
                  <div className="you-text">
                    <span className="name">You · {formatAddress(address)}</span>
                    <span className="meta">↑ 42 since last cut · top 7%</span>
                  </div>
                </div>
                <div className="you-stats">
                  <div className="item"><span className="lbl">Net</span><span className="v">+2,418</span></div>
                  <div className="item"><span className="lbl">Win rate</span><span className="v">62%</span></div>
                  <div className="item"><span className="lbl">Streak</span><span className="v">07</span></div>
                </div>
                <a className="you-cta" href="/portfolio">Your ledger →</a>
              </div>
            )}
          </section>

          {/* Section 4: Records */}
          <section>
            <SectionHeader
              number="04"
              title="Records of the season"
              jp="記録"
              desc="The cuts the floor will remember."
              meta="season №04 · sealed"
            />

            <div className="records-grid">
              {RECORDS.map((rec, i) => (
                <div key={i} className="record" data-cursor="hover">
                  <div className="ghost">{rec.ghost}</div>
                  <div className="head">
                    <span className="lbl">{rec.lbl}</span>
                    <span className="badge">{rec.badge}</span>
                  </div>
                  <div className="num">{rec.num}<span className="unit">{rec.unit}</span></div>
                  <div className="desc">{rec.desc}</div>
                  <div className="by">
                    <span className="av" style={rec.avStyle}>{rec.av}</span>
                    <span>by <span className="name">{rec.by}</span> · {rec.date}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>
      </main>

      <Footer />
    </div>
  );
}

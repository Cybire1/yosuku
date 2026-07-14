'use client';

import { useState, useEffect, useMemo } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import SectionHeader from '@/components/SectionHeader';
import { useLeaderboard, useOracles } from '@/lib/sui/hooks';
import { formatAddress } from '@/lib/leaderboardStats';

// Deterministic decorative kanji from an address — a light, semi-transparent
// identity mark for avatars (texture, not a readable label).
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

  const { data: leaderboard, loading: lbLoading } = useLeaderboard();
  const { active: liveOracles } = useOracles();

  const rankings = leaderboard?.rankings ?? [];
  const meta = leaderboard?.meta ?? {
    period: '24h' as const,
    windowStartMs: 0,
    windowEndMs: 0,
    rankedTraders: 0,
    totalWallets: 0,
    closedCalls: 0,
    totalVolume: 0,
    complete: false,
    unmatchedRedemptions: 0,
  };

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

  // The podium already owns ranks 1-3. Continue the ledger from rank 4 without
  // repeating those accounts in another oversized section.
  const banzukeData = useMemo(() => {
    const rows = [];
    const field = rankings.slice(3, 50);
    for (let i = 0; i < field.length; i += 2) {
      const eastRank = i + 4;
      const westRank = i + 5;
      const east = field[i];
      const west = field[i + 1];
      let tier = 1;
      if (eastRank <= 7) tier = 3;
      else if (eastRank <= 12) tier = 4;
      else tier = 5;
      rows.push({
        rank: eastRank,
        jp: west ? `${eastRank}-${westRank}` : String(eastRank),
        tier,
        east: east ? {
          glyph: glyphFromAddress(east.owner),
          name: fmtAddr(east.owner),
          handle: '',
          pnl: east.pnl,
          meta: `#${eastRank} · ${east.tradeCount} calls · ${east.winRate}% wins`,
        } : null,
        west: west ? {
          glyph: glyphFromAddress(west.owner),
          name: fmtAddr(west.owner),
          handle: '',
          pnl: west.pnl,
          meta: `#${westRank} · ${west.tradeCount} calls · ${west.winRate}% wins`,
        } : null,
      });
    }
    return rows;
  }, [rankings]);


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
                <span className="vermilion">— live from Predict activity</span>
              </div>
              <h1 className="lb-hero-title">
                The<br />
                <span className="vermilion">house</span><br />
                of names.
              </h1>
              <p className="lb-hero-sub">
                {lbLoading
                  ? 'Reading on-chain trade data…'
                  : meta.rankedTraders > 0
                    ? `${meta.rankedTraders.toLocaleString()} traders closed positions in the last 24 hours.`
                    : 'No positions have closed in the last 24 hours yet — the board fills as traders redeem settled bets.'}
                {' '}Ranks use realized P&amp;L: redemption payout minus FIFO-matched entry cost.
              </p>
            </div>
            <div className="lb-meta-col">
              <div>
                <div>Ranked traders · 24H</div>
                <div className="big">{meta.rankedTraders > 0 ? meta.rankedTraders.toLocaleString() : '\u2014'}</div>
              </div>
              <div>
                <div>Realized entry volume</div>
                <div className="big">{meta.totalVolume > 0 ? `$${meta.totalVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '\u2014'}</div>
              </div>
              <div>
                <div>Next market closes in</div>
                <div className="big">{sealStr}</div>
              </div>
              <div className="stamp">
                24H BOARD
                <div style={{ marginTop: 4, fontSize: '8px' }}>ROLLING</div>
              </div>
            </div>
          </div>

          {/* One honest scope: BTC positions closed in the rolling 24-hour window. */}
          <div className="lb-filter-bar">
            <div className="asset-tabs">
              <span className="asset-tab active"><span className="glyph">₿</span> BTC</span>
              <span className="asset-tab">Last 24 hours</span>
            </div>
            <div className="lb-filter-meta">
              {meta.complete ? `${meta.closedCalls.toLocaleString()} realized calls · complete window` : 'indexing recent closes'}
            </div>
          </div>
        </div>
      </section>

      <main>
        <div className="container">

          {/* Loading state */}
          {lbLoading && (
            <div style={{ textAlign: 'center', padding: '64px 0', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
              Reading on-chain trade data…
            </div>
          )}

          {/* Empty state — window is complete but no realized calls yet */}
          {!lbLoading && rankings.length === 0 && (
            <div style={{ textAlign: 'center', padding: '96px 24px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'rgba(255,255,255,0.42)', lineHeight: 2 }}>
              <div style={{ fontSize: '30px', marginBottom: '14px', opacity: 0.35 }}>◷</div>
              No realized calls in this window yet.<br />
              <span style={{ color: 'rgba(255,255,255,0.28)' }}>
                The board ranks traders by realized P&amp;L, so names appear once settled positions are redeemed. Check back after the next few bells settle.
              </span>
            </div>
          )}

          {/* Section 1: Podium */}
          {podiumData.length > 0 && (
            <section>
              <SectionHeader
                number="01"
                title="The podium"
                desc="Top three traders by realized P&L over the last 24 hours."
                meta="live · refreshes automatically"
              />

              <div className="podium">
                {podiumData.map(p => (
                  <div key={p.r} className={`podium-spot s${p.r}`} data-cursor="hover">
                    <span className="podium-rank">{p.r}</span>
                    {p.r === 1 && <span className="sash">GRAND CHAMPION</span>}
                    <div className="podium-eyebrow">
                      <span className="ord">{p.r === 1 ? '1ST' : p.r === 2 ? '2ND' : '3RD'}</span>
                      <span>{p.r === 1 ? `GRAND CHAMPION · ${p.bestStreak} WIN STREAK` : p.r === 2 ? 'CHALLENGER' : 'CONTENDER'}</span>
                    </div>
                    <div className="podium-portrait">{glyphFromAddress(p.owner)}</div>
                    <div className="podium-name">{fmtAddr(p.owner)}</div>
                    <div className="podium-pnl">
                      <span className="sign">{p.pnl >= 0 ? '+' : ''}</span>{fmtPnl(p.pnl)}<span className="cur">DUSDC</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Section 2: ranks four onward */}
          {banzukeData.length > 0 && (
            <section>
              <SectionHeader
                number="02"
                title="The field"
                desc="Ranks four onward, ordered by net realized P&L."
                meta="rolling 24H"
              />

              <div className="banzuke-wrap">
                <div className="banzuke-strip">
                  <span>RANKS 04-50</span>
                  <span className="center">24H · REALIZED P&amp;L</span>
                  <span>ON-CHAIN CLOSES</span>
                </div>
                <div className="banzuke-cols-head">
                  <div className="east">Ranked account</div>
                  <div className="center">RANKS</div>
                  <div className="west">Ranked account</div>
                </div>
                <div>
                  {banzukeData.map((row, i) => {
                    const prevTier = i > 0 ? banzukeData[i - 1].tier : row.tier;
                    return (
                      <div key={row.rank}>
                        {i > 0 && row.tier !== prevTier && row.tier === 4 && (
                          <div className="bz-divider">RANK &amp; FILE</div>
                        )}
                        {i > 0 && row.tier !== prevTier && row.tier === 5 && (
                          <div className="bz-divider">THE LONG TAIL</div>
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
                      <span className="of">of {meta.rankedTraders > 0 ? meta.rankedTraders.toLocaleString() : '\u2014'} ranked traders</span>
                    </span>
                  </div>
                  <div className="you-info">
                    <div className="you-portrait">{glyphFromAddress(address)}</div>
                    <div className="you-text">
                      <span className="name">You · {formatAddress(address)}</span>
                      <span className="meta">{userRankData ? `top ${Math.round((userRankData.rank / Math.max(1, meta.rankedTraders)) * 100)}%` : 'no realized calls in the last 24H'}</span>
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

        </div>
      </main>

      <Footer />
    </div>
  );
}

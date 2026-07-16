'use client';

// ── Word markets ──────────────────────────────────────────────────────────
// A Polymarket-style board of NATURAL-LANGUAGE Bitcoin questions with scheduled
// close times. Every question is a real, live 6-24 market reworded: "Will Bitcoin
// be above $X at 3:12?" is the venue's own near-spot UP line, settled by the same
// oracle. HONEST SCOPE: the venue settles on the Pyth spot at expiry, so questions
// are near-spot price/time questions (not arbitrary events) — far strikes abort
// on-chain (EEntryProbabilityOutOfBounds), so we phrase around the live line.
// Tapping Yes/No hands off to the proven ticket (/markets-live) with the market +
// side preselected — the board owns discovery, the ticket owns the bet.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Marquee from '@/components/Marquee';
import { fetchMarkets624, fetchSpot624, type Market624, type Cadence624 } from '@/lib/sui/predict624Client';
import { BAND_USD } from '@/lib/sui/ticket624';

const usd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const clockHM = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtCountdown = (ms: number) => {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

// honest client-side odds estimate — a logistic on (line − spot)/σ, σ scaled by
// time-to-expiry. Mirrors the landing dial; the EXACT price is quoted at bet time.
function probAbove(spot: number, line: number, msLeft: number): number {
  const secs = Math.max(45, msLeft / 1000);
  const sigma = spot * 0.00028 * Math.sqrt(secs / 60); // ~ vol × √t, tuned to the 1e-3/min band
  const z = (spot - line) / (sigma || 1);
  return Math.max(0.03, Math.min(0.97, 1 / (1 + Math.exp(-1.15 * z))));
}

interface WordQ {
  market: Market624;
  line: number;          // the UP line (spot − band); Yes = BTC above it at expiry
  text: string;
  yesProb: number;
  closeMs: number;
}

const HORIZONS: { key: string; label: string; jp: string; test: (m: Market624, now: number) => boolean }[] = [
  { key: 'soon', label: 'Closing in minutes', jp: '数分', test: (m, now) => m.expiry - now <= 6 * 60_000 },
  { key: 'hour', label: 'Closing this hour', jp: 'この時間', test: (m, now) => m.expiry - now > 6 * 60_000 && m.expiry - now <= 65 * 60_000 },
  { key: 'later', label: 'Later today', jp: '本日', test: (m, now) => m.expiry - now > 65 * 60_000 },
];

const TEMPLATES = [
  (line: string, t: string) => `Will Bitcoin be above ${line} at ${t}?`,
  (line: string, t: string) => `Bitcoin still over ${line} when the clock hits ${t}?`,
  (line: string, t: string) => `Will BTC hold ${line} through ${t}?`,
  (line: string, t: string) => `Bitcoin above ${line} by ${t}?`,
];

export default function WordsPage() {
  const router = useRouter();
  const [now, setNow] = useState(0);
  const [markets, setMarkets] = useState<Market624[]>([]);
  const [spot, setSpot] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [ms, sp] = await Promise.all([fetchMarkets624(), fetchSpot624().catch(() => null)]);
        if (!alive) return;
        setMarkets(ms);
        if (sp != null) setSpot(sp);
        setLoaded(true);
      } catch { if (alive) setLoaded(true); }
    };
    load();
    const id = setInterval(load, 12_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const questions: WordQ[] = useMemo(() => {
    if (spot == null || now === 0) return [];
    const line = spot - BAND_USD;
    return markets
      .filter((m) => m.expiry - now > 20_000)
      .sort((a, b) => a.expiry - b.expiry)
      .map((m, i) => {
        const msLeft = m.expiry - now;
        return {
          market: m,
          line,
          text: TEMPLATES[i % TEMPLATES.length](usd0(line), clockHM(m.expiry)),
          yesProb: probAbove(spot, line, msLeft),
          closeMs: m.expiry,
        };
      });
  }, [markets, spot, now]);

  const grouped = useMemo(
    () => HORIZONS.map((h) => ({ ...h, items: questions.filter((q) => h.test(q.market, now)) })).filter((g) => g.items.length > 0),
    [questions, now],
  );

  const go = (q: WordQ, side: 'yes' | 'no') =>
    router.push(`/markets-live?m=${q.market.id}&dir=${side === 'yes' ? 'up' : 'down'}`);

  return (
    <>
      <Marquee />
      <Header />
      <main className="words-wrap">
        <div className="container">
          <div className="mkt-viewtoggle" role="tablist" aria-label="Market view">
            <a href="/markets" className="vt-pill" data-cursor="hover">Chart</a>
            <span className="vt-pill active" role="tab" aria-selected="true">Words</span>
          </div>
          <div className="words-hero">
            <div className="words-eyebrow">言葉市場 · WORD MARKETS</div>
            <h1 className="words-title">Bet the <span className="accent">question</span>,<br />not the chart.</h1>
            <p className="words-sub">
              Plain-language Bitcoin calls with a scheduled close. Every one is a live oracle‑settled market —
              pick a side, it pays out on the exact‑expiry price. {spot != null && <span className="words-spot">BTC {usd0(spot)}</span>}
            </p>
          </div>

          {!loaded ? (
            <div className="words-empty">reading the board…</div>
          ) : grouped.length === 0 ? (
            <div className="words-empty">Between rounds — new questions open every minute.</div>
          ) : (
            grouped.map((g) => (
              <section key={g.key} className="words-section">
                <div className="words-sechead">
                  <span className="words-sec-jp">{g.jp}</span>
                  <span className="words-sec-label">{g.label}</span>
                  <span className="words-sec-count">{g.items.length}</span>
                </div>
                <div className="words-grid">
                  {g.items.map((q) => {
                    const yes = Math.round(q.yesProb * 100);
                    const msLeft = q.closeMs - now;
                    const urgent = msLeft < 60_000;
                    return (
                      <div key={q.market.id} className="wq-card">
                        <div className="wq-top">
                          <span className="wq-chip">₿</span>
                          <span className="wq-meta">BTC · oracle‑settled</span>
                          <span className={`wq-clock ${urgent ? 'urgent' : ''}`}>{fmtCountdown(msLeft)}</span>
                        </div>
                        <div className="wq-q">{q.text}</div>
                        <div className="wq-close">closes {clockHM(q.closeMs)}</div>
                        <div className="wq-actions">
                          <button className="wq-btn yes" onClick={() => go(q, 'yes')} data-cursor="hover">
                            <span className="wq-side">Yes</span><span className="wq-cents">{yes}¢</span>
                          </button>
                          <button className="wq-btn no" onClick={() => go(q, 'no')} data-cursor="hover">
                            <span className="wq-side">No</span><span className="wq-cents">{100 - yes}¢</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}

          <p className="words-foot">
            Odds shown are a live estimate; the exact price is quoted the moment you place. Yes = BTC above the line at close · No = below.
            Testnet.
          </p>
        </div>
      </main>
    </>
  );
}

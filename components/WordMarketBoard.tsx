'use client';

// The word-market board — live 6-24 BTC markets reworded as natural-language, time-
// scheduled Yes/No questions. Self-contained (fetches its own markets + spot) so it can
// drop in under the markets page OR stand alone. Yes/No hands off to the proven ticket.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchMarkets624, fetchSpot624, type Market624 } from '@/lib/sui/predict624Client';
import { BAND_USD } from '@/lib/sui/ticket624';

const usd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const clockHM = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtCountdown = (ms: number) => {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

// honest client-side odds estimate — logistic on (line − spot)/σ, σ scaled by time-to-expiry.
function probAbove(spot: number, line: number, msLeft: number): number {
  const secs = Math.max(45, msLeft / 1000);
  const sigma = spot * 0.00028 * Math.sqrt(secs / 60);
  const z = (spot - line) / (sigma || 1);
  return Math.max(0.03, Math.min(0.97, 1 / (1 + Math.exp(-1.15 * z))));
}

interface WordQ { market: Market624; line: number; text: string; yesProb: number; closeMs: number; }

const HORIZONS = [
  { key: 'soon', label: 'Closing in minutes', jp: '数分', test: (m: Market624, now: number) => m.expiry - now <= 6 * 60_000 },
  { key: 'hour', label: 'Closing this hour', jp: 'この時間', test: (m: Market624, now: number) => m.expiry - now > 6 * 60_000 && m.expiry - now <= 65 * 60_000 },
  { key: 'later', label: 'Later today', jp: '本日', test: (m: Market624, now: number) => m.expiry - now > 65 * 60_000 },
];
const TEMPLATES = [
  (l: string, t: string) => `Will Bitcoin be above ${l} at ${t}?`,
  (l: string, t: string) => `Bitcoin still over ${l} when the clock hits ${t}?`,
  (l: string, t: string) => `Will BTC hold ${l} through ${t}?`,
  (l: string, t: string) => `Bitcoin above ${l} by ${t}?`,
];

export default function WordMarketBoard() {
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
        setMarkets(ms); if (sp != null) setSpot(sp); setLoaded(true);
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
      .map((m, i) => ({
        market: m, line,
        text: TEMPLATES[i % TEMPLATES.length](usd0(line), clockHM(m.expiry)),
        yesProb: probAbove(spot, line, m.expiry - now),
        closeMs: m.expiry,
      }));
  }, [markets, spot, now]);

  const grouped = useMemo(
    () => HORIZONS.map((h) => ({ ...h, items: questions.filter((q) => h.test(q.market, now)) })).filter((g) => g.items.length > 0),
    [questions, now],
  );

  const go = (q: WordQ, side: 'yes' | 'no') => router.push(`/markets-live?m=${q.market.id}&dir=${side === 'yes' ? 'up' : 'down'}`);

  if (!loaded) return <div className="words-empty">reading the board…</div>;
  if (grouped.length === 0) return <div className="words-empty">Between rounds — new questions open every minute.</div>;

  return (
    <>
      {grouped.map((g) => (
        <div key={g.key} className="words-section">
          <div className="words-sechead">
            <span className="words-sec-jp">{g.jp}</span>
            <span className="words-sec-label">{g.label}</span>
            <span className="words-sec-count">{g.items.length}</span>
          </div>
          <div className="words-grid">
            {g.items.map((q) => {
              const yes = Math.round(q.yesProb * 100);
              const msLeft = q.closeMs - now;
              return (
                <div key={q.market.id} className="wq-card">
                  <div className="wq-top">
                    <span className="wq-chip">₿</span>
                    <span className="wq-meta">BTC · oracle‑settled</span>
                    <span className={`wq-clock ${msLeft < 60_000 ? 'urgent' : ''}`}>{fmtCountdown(msLeft)}</span>
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
        </div>
      ))}
    </>
  );
}

// Daily loss stop — an honest brake on a fast-round market.
// Client-side, per-browser: the user sets a max net loss per day (DUSDC);
// realized P&L (cash-outs and settlements) is recorded, and the trade panel
// refuses new entries once the stop is hit. Resets at local midnight.
import { useCallback, useEffect, useState } from 'react';

const LIMIT_KEY = 'yosuku_daily_stop_limit';
const PNL_KEY = 'yosuku_daily_pnl';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function getDailyStop(): number | null {
  try {
    const raw = localStorage.getItem(LIMIT_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

export function setDailyStop(limit: number | null) {
  try {
    if (limit === null || !Number.isFinite(limit) || limit <= 0) localStorage.removeItem(LIMIT_KEY);
    else localStorage.setItem(LIMIT_KEY, String(limit));
  } catch { /* ignore */ }
}

/** Record realized P&L in DUSDC (negative = loss). */
export function recordPnl(deltaDusdc: number) {
  try {
    const raw = localStorage.getItem(PNL_KEY);
    const cur = raw ? (JSON.parse(raw) as { date: string; net: number }) : null;
    const net = cur && cur.date === todayKey() ? cur.net + deltaDusdc : deltaDusdc;
    localStorage.setItem(PNL_KEY, JSON.stringify({ date: todayKey(), net }));
  } catch { /* ignore */ }
}

/** Net realized loss today, as a positive DUSDC number (0 if net positive). */
export function getTodayLoss(): number {
  try {
    const raw = localStorage.getItem(PNL_KEY);
    if (!raw) return 0;
    const cur = JSON.parse(raw) as { date: string; net: number };
    if (cur.date !== todayKey()) return 0;
    return Math.max(0, -cur.net);
  } catch { return 0; }
}

export function useDailyStop() {
  const [limit, setLimitState] = useState<number | null>(null);
  const [todayLoss, setTodayLoss] = useState(0);

  const refresh = useCallback(() => {
    setLimitState(getDailyStop());
    setTodayLoss(getTodayLoss());
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const setLimit = useCallback((v: number | null) => {
    setDailyStop(v);
    refresh();
  }, [refresh]);

  const stopHit = limit !== null && todayLoss >= limit;
  return { limit, setLimit, todayLoss, stopHit, refresh };
}

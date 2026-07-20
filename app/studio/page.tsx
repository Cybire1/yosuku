'use client';

// yosuku.xyz/studio — the founder's Line Studio. Pick a market + strike, preview the card, and
// post a live line (from the bot, or copy it for a hand-post). Talks only to /api/studio/*, which
// holds the box secret; this page never sees it. Passphrase-gated (STUDIO_PASSPHRASE).
import { useState, useEffect, useCallback, useRef } from 'react';

type Market = { id: string; cadence: string; expiry: number; minsOut: number; closeLabel: string; cutoffLabel: string; cutoffMs: number };
type Options = { spot: number; coinflip: number; ladder: number[]; grid: number; markets: Market[] };
type Preview = { marketId: string; cadence: string; strikeUsd: number; spot: number; closeLabel: string; cutoffLabel: string; minsOut: number; caption: string; cardPngBase64: string };
type Line = { cardId: string; strikeUsd: number | null; closeLabel: string | null; cutoffMs: number; open: boolean; betters: number };

const PASS_KEY = 'yosuku_studio_pass';
const VERM = '#E04D26';
const money = (n: number) => '$' + Number(n).toLocaleString('en-US');

export default function StudioPage() {
  const [pass, setPass] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [authing, setAuthing] = useState(false);
  const [authErr, setAuthErr] = useState('');

  const [opts, setOpts] = useState<Options | null>(null);
  const [marketId, setMarketId] = useState<string | null>(null);
  const [strike, setStrike] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [posting, setPosting] = useState<'' | 'bot' | 'hand'>('');
  const [result, setResult] = useState<{ tweetUrl?: string; mode: string; caption: string } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState('');

  const api = useCallback(async (action: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => {
    const p = pass || (typeof window !== 'undefined' ? sessionStorage.getItem(PASS_KEY) : '') || '';
    const r = await fetch(`/api/studio/${action}`, {
      method,
      headers: { 'x-studio-pass': p, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `error ${r.status}`);
    return j;
  }, [pass]);

  const unlock = useCallback(async () => {
    setAuthing(true); setAuthErr('');
    try { await api('auth'); sessionStorage.setItem(PASS_KEY, pass); setUnlocked(true); }
    catch { setAuthErr('Wrong passphrase.'); }
    finally { setAuthing(false); }
  }, [api, pass]);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? sessionStorage.getItem(PASS_KEY) : null;
    if (saved) { setPass(saved); setUnlocked(true); }
  }, []);

  const loadOptions = useCallback(async () => {
    try {
      const o: Options = await api('options');
      setOpts(o);
      setMarketId((cur) => cur && o.markets.some((m) => m.id === cur) ? cur : (o.markets[0]?.id ?? null));
      setStrike((cur) => cur || String(o.coinflip));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [api]);

  const loadLines = useCallback(async () => { try { const j = await api('lines'); setLines(j.lines || []); } catch { /* ignore */ } }, [api]);

  useEffect(() => { if (unlocked) { loadOptions(); loadLines(); } }, [unlocked, loadOptions, loadLines]);

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!unlocked || !marketId || !strike) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      setPreviewing(true); setErr('');
      try { setPreview(await api('preview', 'POST', { marketId, strikeUsd: Number(strike) })); }
      catch (e) { setErr(e instanceof Error ? e.message : String(e)); setPreview(null); }
      finally { setPreviewing(false); }
    }, 350);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [unlocked, marketId, strike, api]);

  const post = useCallback(async (mode: 'bot' | 'hand') => {
    if (!marketId || !strike || posting) return;
    setPosting(mode); setErr(''); setResult(null);
    try {
      const r = await api('post', 'POST', { marketId, strikeUsd: Number(strike), mode });
      if (mode === 'hand') { try { await navigator.clipboard.writeText(r.caption); } catch { /* clipboard may be blocked */ } }
      setResult({ tweetUrl: r.tweetUrl, mode, caption: r.caption });
      loadLines();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setPosting(''); }
  }, [api, marketId, strike, posting, loadLines]);

  // ── passphrase gate ──
  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0b0c] px-6">
        <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#141416] p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-gray-500">Yosuku</div>
          <h1 className="mt-1 font-display text-2xl font-[800] text-[#f5f2ec]">Line Studio</h1>
          <p className="mt-1 text-sm text-gray-400">Post a live line to X in a few taps.</p>
          <input
            type="password" value={pass} onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') unlock(); }}
            placeholder="passphrase" autoFocus
            className="mt-4 w-full rounded-xl border border-white/10 bg-[#19191c] px-4 py-3 text-[#f5f2ec] outline-none focus:border-white/25"
          />
          <button onClick={unlock} disabled={authing || !pass} className="mt-3 w-full rounded-xl px-4 py-3 text-sm font-bold text-[#f5f2ec] disabled:opacity-50" style={{ background: VERM }}>
            {authing ? 'Checking…' : 'Unlock'}
          </button>
          {authErr && <div className="mt-2 text-[12px] text-[#E04D26]">{authErr}</div>}
        </div>
      </div>
    );
  }

  const cadenceOrder: Record<string, number> = { '1h': 0, '5m': 1, '1m': 2 };
  const markets = (opts?.markets ?? []).slice().sort((a, b) => (cadenceOrder[a.cadence] ?? 9) - (cadenceOrder[b.cadence] ?? 9));

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#f5f2ec]">
      <div className="mx-auto max-w-md px-5 py-8">
        {/* header */}
        <div className="flex items-end justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-gray-500">Yosuku · Line Studio</div>
            <h1 className="mt-0.5 font-display text-2xl font-[800]">Post a live line</h1>
          </div>
          <button onClick={() => { loadOptions(); loadLines(); }} className="font-mono text-[11px] text-gray-400 hover:text-[#f5f2ec]">refresh</button>
        </div>
        {opts && (
          <div className="mt-1 font-mono text-[12px] text-gray-400">BTC <span className="text-[#f5f2ec] tabular-nums">{money(opts.spot)}</span> · spot live</div>
        )}

        {/* market picker */}
        <div className="mt-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-2">Market</div>
          {markets.length === 0 ? (
            <div className="rounded-xl border border-white/10 px-4 py-3 text-[13px] text-gray-400">No funded market in the window right now. Markets roll, hit refresh in a moment.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {markets.map((m) => {
                const on = m.id === marketId;
                return (
                  <button key={m.id} onClick={() => setMarketId(m.id)}
                    className={`rounded-xl border px-3.5 py-2 text-left transition-colors ${on ? 'border-[#E04D26] bg-[#E04D26]/[0.08]' : 'border-white/10 hover:border-white/25'}`}>
                    <div className="font-display text-sm font-[700]">{m.cadence}</div>
                    <div className="font-mono text-[10px] text-gray-400">closes {m.closeLabel} · {m.minsOut}m</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* strike */}
        <div className="mt-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-2">Strike</div>
          <div className="flex flex-wrap gap-2">
            {(opts?.ladder ?? []).map((s) => {
              const on = String(s) === strike;
              const cf = s === opts?.coinflip;
              return (
                <button key={s} onClick={() => setStrike(String(s))}
                  className={`rounded-lg border px-3 py-2 font-mono text-xs transition-colors ${on ? 'border-[#E04D26] text-[#f5f2ec]' : 'border-white/10 text-gray-300 hover:text-[#f5f2ec]'}`}>
                  {money(s)}{cf && <span className="ml-1 text-[9px] text-[#E04D26]">~50%</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 w-fit">
            <span className="text-gray-500 text-sm">$</span>
            <input value={strike} onChange={(e) => setStrike(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric"
              aria-label="Custom strike price" className="w-24 bg-transparent text-[#f5f2ec] text-sm outline-none tabular-nums" />
            <span className="font-mono text-[10px] text-gray-600">custom</span>
          </div>
        </div>

        {/* preview */}
        <div className="mt-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-2">Preview {previewing && <span className="text-gray-600">· rendering…</span>}</div>
          <div className="rounded-2xl border border-white/[0.08] bg-[#141416] p-3">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:image/png;base64,${preview.cardPngBase64}`} alt="live line card" className="w-full rounded-xl" />
            ) : (
              <div className="py-14 text-center font-mono text-[12px] text-gray-600">{err ? '—' : 'pick a market + strike'}</div>
            )}
            {preview && (
              <p className="mt-3 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-gray-400">{preview.caption}</p>
            )}
          </div>
        </div>

        {/* actions */}
        <div className="mt-4 flex gap-2">
          <button onClick={() => post('bot')} disabled={!preview || !!posting}
            className="flex-1 rounded-xl px-4 py-3 text-sm font-bold text-[#f5f2ec] disabled:opacity-50" style={{ background: VERM }}>
            {posting === 'bot' ? 'Posting…' : 'Post from bot'}
          </button>
          <button onClick={() => post('hand')} disabled={!preview || !!posting}
            className="rounded-xl border border-white/15 px-4 py-3 text-sm font-bold text-[#f5f2ec] hover:bg-white/[0.06] disabled:opacity-50">
            {posting === 'hand' ? 'Arming…' : 'Copy for hand-post'}
          </button>
        </div>

        {err && <div className="mt-3 text-[12px] text-[#E04D26]">{err}</div>}

        {result && (
          <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
            {result.mode === 'bot' ? (
              <>
                <div className="text-sm font-bold text-emerald-300">Line is live.</div>
                <div className="mt-1 text-[12px] text-gray-400">The relay auto-registers it within ~15s, then UP/DOWN replies start trading.</div>
                {result.tweetUrl && <a href={result.tweetUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-[12px] text-emerald-400 underline">view the post ↗</a>}
              </>
            ) : (
              <>
                <div className="text-sm font-bold text-emerald-300">Caption copied. Relay armed.</div>
                <div className="mt-1 text-[12px] text-gray-400">Post the card from @yosuku0 by hand. The relay auto-detects your drop within ~15s, no register step.</div>
              </>
            )}
          </div>
        )}

        {/* live now */}
        <div className="mt-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500 mb-2">Live now</div>
          {lines.length === 0 ? (
            <div className="font-mono text-[12px] text-gray-600">no lines being watched</div>
          ) : (
            <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.08]">
              {lines.map((l) => (
                <div key={l.cardId} className="flex items-center justify-between px-4 py-2.5">
                  <div className="font-mono text-[12px] text-gray-300">
                    {l.strikeUsd != null ? money(l.strikeUsd) : '—'} <span className="text-gray-600">·</span> {l.closeLabel || '—'}
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px]">
                    <span className="text-gray-500">{l.betters} bet{l.betters === 1 ? '' : 's'}</span>
                    <span className={l.open ? 'text-emerald-400' : 'text-gray-600'}>{l.open ? 'open' : 'closed'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 font-mono text-[10px] text-gray-700">Bets settle on the BTC price at close. Testnet.</div>
      </div>
    </div>
  );
}

'use client';

// "Share card ↗" — renders the Earned Heat PNG for one settled trade, then
// hands it to the native share sheet when available; otherwise downloads the
// PNG and opens a pre-filled (honest, real-numbers-only) X intent so the user
// can paste the image themselves.

import { useState } from 'react';
import type { SettledTrade } from '@/lib/sui/settledTrade';
import { renderTradeShareCard, buildTradeTweetText, shortOrderId } from '@/lib/shareCard';
import { useToast } from '@/components/Toast';

/** useToast throws outside <ToastProvider>; degrade to null instead of crashing
 *  the receipt. The underlying useContext call keeps hook order stable. */
function useOptionalToast(): ((message: string, type?: 'success' | 'error' | 'info') => void) | null {
  try {
    return useToast().toast;
  } catch {
    return null;
  }
}

export default function ShareTradeButton({ trade }: { trade: SettledTrade }) {
  const [busy, setBusy] = useState(false);
  const toast = useOptionalToast();

  async function onShare() {
    if (busy) return;
    setBusy(true);

    // Decide the path synchronously (still inside the click gesture) so the
    // X-intent tab can be opened before any await — late window.open calls
    // get popup-blocked once the render has taken more than a beat.
    const probe = new File([new Uint8Array(8)], 'probe.png', { type: 'image/png' });
    const canNativeShare =
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [probe] });
    let intentWin: Window | null = null;
    if (!canNativeShare && typeof window !== 'undefined') {
      intentWin = window.open('about:blank', '_blank');
      if (intentWin) intentWin.opener = null;
    }
    const closeIntentWin = () => {
      try { intentWin?.close(); } catch { /* cross-origin after navigation — ignore */ }
    };

    try {
      const blob = await renderTradeShareCard(trade);
      const fileName = `yosuku-trade-${shortOrderId(trade)}.png`;
      const text = buildTradeTweetText(trade);
      const file = new File([blob], fileName, { type: 'image/png' });
      const intentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;

      // (1) native share sheet with the image, when the platform supports files
      if (canNativeShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text });
          return;
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') return; // user closed the sheet
          // share failed for another reason — fall through to download + intent
        }
      }

      // (2) download the PNG…
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);

      // …and open the pre-filled tweet (user attaches the downloaded image)
      if (intentWin) {
        intentWin.location.href = intentUrl;
        intentWin = null; // handed off — don't close it
      } else {
        // Only reached when the native path failed late — this open sits past
        // several awaits, so popup blockers may eat it. The PNG is already saved
        // either way; if the tab is blocked, say what the user has.
        const w = window.open(intentUrl, '_blank', 'noopener,noreferrer');
        if (!w && toast) toast('Card saved — attach it to your post on X', 'success');
      }
    } catch (err) {
      if (toast) toast('Could not render the share card', 'error');
      else console.warn('[ShareTradeButton] share card failed:', err);
    } finally {
      closeIntentWin();
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onShare}
      disabled={busy}
      aria-busy={busy}
      className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50 hover:text-vermilion transition-colors disabled:opacity-50 disabled:cursor-wait"
    >
      {busy ? 'Rendering…' : 'Share card ↗'}
    </button>
  );
}

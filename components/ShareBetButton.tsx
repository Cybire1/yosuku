'use client';

// "Share this call ↗" — renders The Call PNG for one just-placed bet, then hands
// it to the native share sheet when available; otherwise downloads the PNG and
// opens a pre-filled (honest, real-numbers-only) X intent so the user can attach
// the image themselves. Mirrors ShareTradeButton's popup-blocker-safe flow.

import { useState, type ReactNode } from 'react';
import {
  renderOpenBetShareCard,
  buildCallTweetText,
  shortCallId,
  type OpenBetCard,
} from '@/lib/openBetShareCard';
import { useToast } from '@/components/Toast';

/** useToast throws outside <ToastProvider>; degrade to null instead of crashing. */
function useOptionalToast(): ((message: string, type?: 'success' | 'error' | 'info') => void) | null {
  try {
    return useToast().toast;
  } catch {
    return null;
  }
}

export default function ShareBetButton({
  call,
  className,
  label = 'Share this call',
}: {
  call: OpenBetCard;
  className?: string;
  label?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useOptionalToast();

  async function onShare() {
    if (busy) return;
    setBusy(true);

    // Decide the path synchronously (still inside the click gesture) so the
    // X-intent tab can be opened before any await — late window.open calls get
    // popup-blocked once the render has taken more than a beat.
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
      const blob = await renderOpenBetShareCard(call);
      const fileName = `yosuku-call-${shortCallId(call)}.png`;
      const text = buildCallTweetText(call);
      const file = new File([blob], fileName, { type: 'image/png' });
      const intentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;

      if (canNativeShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text });
          return;
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') return; // user closed the sheet
          // fall through to download + intent
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);

      if (intentWin) {
        intentWin.location.href = intentUrl;
        intentWin = null; // handed off — don't close it
      } else {
        const w = window.open(intentUrl, '_blank', 'noopener,noreferrer');
        if (!w && toast) toast('Card saved — attach it to your post on X', 'success');
      }
    } catch (err) {
      if (toast) toast('Could not render the share card', 'error');
      else console.warn('[ShareBetButton] share card failed:', err);
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
      data-cursor="hover"
      className={
        className ??
        'inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50 hover:text-vermilion transition-colors disabled:opacity-50 disabled:cursor-wait'
      }
    >
      {busy ? 'Rendering…' : <>{label} ↗</>}
    </button>
  );
}

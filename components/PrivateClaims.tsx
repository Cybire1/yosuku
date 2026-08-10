'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, Download, Upload, Loader2 } from 'lucide-react';
import {
  loadPrivateBetTickets,
  savePrivateBetTickets,
  type PrivateBetTicket,
} from '@/lib/privateBet';

type SignedPrivateBetTicket = PrivateBetTicket & {
  ticketHex?: string;
  signatureHex?: string;
  enclavePublicKey?: string;
};

/**
 * Your private positions, and the proof each one is yours.
 *
 * This screen exists because of a deliberate trade: the desk keeps no record of who owns which
 * position, so nobody there can read your bets, and nobody there can reconstruct your claim if
 * you lose it. That makes "keep a copy" a real thing a person has to do, not a footnote. So the
 * backup control is a primary action here rather than something buried in settings.
 *
 * The verify control is the other half. It checks the enclave's signature locally, against the
 * key pinned on chain, so trusting the claim never requires trusting us to answer honestly.
 */
export default function PrivateClaims({
  claims,
  enclavePublicKey,
  owner,
  onCashOut,
  busyDigest,
}: {
  claims: PrivateBetTicket[];
  enclavePublicKey?: string;
  owner?: string | null;
  onCashOut?: (claim: PrivateBetTicket) => void;
  busyDigest?: string | null;
}) {
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [restored, setRestored] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Verify every claim on sight. Making the user press a button to find out their bet is real
  // would be putting the burden in the wrong place.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, boolean> = {};
      for (const c of claims) next[c.digest] = await verifyClaim(c, enclavePublicKey);
      if (!cancelled) setVerified(next);
    })();
    return () => { cancelled = true; };
  }, [claims, enclavePublicKey]);

  const backUp = useCallback(() => {
    const blob = new Blob([
      JSON.stringify({
        kind: 'yosuku.private.claims',
        version: 1,
        exportedAt: Date.now(),
        claims,
      }, null, 2),
    ], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yosuku-private-claims-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [claims]);

  const restore = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { claims?: PrivateBetTicket[] };
      const incoming = Array.isArray(parsed?.claims) ? parsed.claims : [];
      const existing = loadPrivateBetTickets(owner);
      const seen = new Set(existing.map((ticket) => ticket.digest));
      const additions = incoming.filter((ticket) => ticket?.digest && !seen.has(ticket.digest));
      if (additions.length > 0) savePrivateBetTickets([...additions, ...existing]);
      const added = additions.length;
      setRestored(added > 0 ? `Restored ${added} claim${added === 1 ? '' : 's'}.` : 'Nothing new in that file.');
    } catch {
      setRestored('That file could not be read.');
    }
  }, [owner]);

  if (claims.length === 0) {
    return (
      <div className="pc-empty">
        <p className="pc-empty-title">No private positions yet</p>
        <p className="pc-empty-sub">
          Turn on private trading before you place a bet and your address stays off the position.
        </p>
        <StyleTag />
      </div>
    );
  }

  return (
    <div className="pc">
      <div className="pc-head">
        <div>
          <h3 className="pc-title">Private positions</h3>
          <p className="pc-sub">Only you hold the proof these are yours.</p>
        </div>
        <div className="pc-actions">
          <button type="button" onClick={backUp} className="pc-btn">
            <Download className="w-3.5 h-3.5" aria-hidden />
            Back up
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="pc-btn">
            <Upload className="w-3.5 h-3.5" aria-hidden />
            Restore
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }}
          />
        </div>
      </div>

      {restored && <p className="pc-note" role="status">{restored}</p>}

      {claims.some((c) => verified[c.digest] === false) && (
        <p className="pc-warn">
          One of these was not signed by the attested enclave, so cashing it out is blocked. That
          usually means the file it was restored from was edited. Restore from a clean backup.
        </p>
      )}

      <ul className="pc-list">
        {claims.map((c) => {
          const ok = verified[c.digest];
          const busy = busyDigest === c.digest;
          return (
            <li key={c.digest} className="pc-row">
              <div className="pc-row-main">
                <span className={`pc-side ${c.side === 'UP' ? 'is-up' : 'is-down'}`}>{c.side}</span>
                <span className="pc-strike">${c.strike.toLocaleString()}</span>
                <span className="pc-stake">{(c.stakeMicro / 1e6).toFixed(2)} DUSDC</span>
                {/* What you actually won. A settled row that only shows the stake makes a
                    person do arithmetic to find out how they did. */}
                {typeof c.payoutDusdc === 'number' && c.status !== 'open' && (
                  <span className={`pc-payout ${c.payoutDusdc >= c.stakeMicro / 1e6 ? 'is-win' : 'is-loss'}`}>
                    {c.payoutDusdc >= c.stakeMicro / 1e6 ? '+' : ''}
                    {(c.payoutDusdc - c.stakeMicro / 1e6).toFixed(2)}
                  </span>
                )}
                <span className="pc-when">{sinceLabel(c.openedAt)}</span>
              </div>

              <div className="pc-row-side">
                {ok === undefined ? (
                  <span className="pc-check is-checking">Checking</span>
                ) : ok ? (
                  <span className="pc-check is-ok" title="Signed by the attested enclave">
                    <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
                    Verified
                  </span>
                ) : (
                  <span className="pc-check is-bad" title="This claim was not signed by the attested enclave">
                    <ShieldAlert className="w-3.5 h-3.5" aria-hidden />
                    Unverified
                  </span>
                )}

                {c.status === 'open' && onCashOut && (
                  <button
                    type="button"
                    onClick={() => onCashOut(c)}
                    disabled={busy || ok === false}
                    className="pc-cash"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : null}
                    {busy ? 'Cashing out' : 'Cash out'}
                  </button>
                )}
                {c.status !== 'open' && <span className="pc-status">{c.status.replace(/_/g, ' ')}</span>}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="pc-foot">
        Keep your backup somewhere safe. Nobody at Yosuku can rebuild these for you, which is the
        same reason nobody there can read them.
      </p>
      <StyleTag />
    </div>
  );
}

function sinceLabel(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

async function verifyClaim(
  ticket: PrivateBetTicket,
  enclavePublicKey?: string,
): Promise<boolean> {
  const signed = ticket as SignedPrivateBetTicket;
  const publicKey = (enclavePublicKey ?? signed.enclavePublicKey ?? '').replace(/^0x/, '');
  if (!publicKey || !signed.ticketHex || !signed.signatureHex) return false;

  try {
    const { Ed25519PublicKey } = await import('@mysten/sui/keypairs/ed25519');
    const key = new Ed25519PublicKey(hexToBytes(publicKey));
    return await key.verify(hexToBytes(signed.ticketHex), hexToBytes(signed.signatureHex));
  } catch {
    return false;
  }
}

function hexToBytes(value: string): Uint8Array {
  const hex = value.replace(/^0x/, '');
  if (hex.length % 2 !== 0 || !/^[a-fA-F0-9]+$/.test(hex)) {
    throw new Error('Invalid hex value');
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function StyleTag() {
  return (
    <style jsx global>{`
      .pc, .pc-empty {
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.3);
        border-radius: 16px;
        padding: 16px;
      }
      .pc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .pc-title { font-size: 14px; font-weight: 700; color: #fff; margin: 0; }
      .pc-sub, .pc-empty-sub { font-size: 12px; color: rgba(255,255,255,0.55); margin: 2px 0 0; }
      .pc-empty-title { font-size: 14px; font-weight: 700; color: #fff; margin: 0; }
      .pc-actions { display: flex; gap: 8px; }
      .pc-btn {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8);
        border: 1px solid rgba(255,255,255,0.14); border-radius: 999px;
        padding: 6px 12px; background: transparent; transition: background .15s, color .15s;
      }
      .pc-btn:hover { background: rgba(255,255,255,0.07); color: #fff; }
      .pc-note { font-size: 12px; color: rgba(255,255,255,0.7); margin: 10px 0 0; }
      .pc-list { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .pc-row {
        display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
        border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 10px 12px;
      }
      .pc-row-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .pc-row-side { display: flex; align-items: center; gap: 10px; }
      .pc-side { font-size: 11px; font-weight: 800; letter-spacing: .06em; padding: 2px 8px; border-radius: 999px; }
      .pc-side.is-up { color: #34D399; background: rgba(52,211,153,.12); }
      .pc-side.is-down { color: #FB7185; background: rgba(251,113,133,.12); }
      .pc-strike { font-size: 13px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; }
      .pc-stake { font-size: 12px; color: rgba(255,255,255,0.6); font-variant-numeric: tabular-nums; }
      .pc-payout { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .pc-payout.is-win { color: #34D399; }
      .pc-payout.is-loss { color: #FB7185; }
      .pc-when { font-size: 11px; color: rgba(255,255,255,0.35); }
      .pc-warn {
        font-size: 12px; line-height: 1.5; color: #FCA5A5; margin: 10px 0 0;
        border: 1px solid rgba(251,113,133,.25); background: rgba(251,113,133,.08);
        border-radius: 10px; padding: 8px 10px;
      }
      .pc-check { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; }
      .pc-check.is-ok { color: #34D399; }
      .pc-check.is-bad { color: #FB7185; }
      .pc-check.is-checking { color: rgba(255,255,255,0.4); }
      .pc-status { font-size: 11px; color: rgba(255,255,255,0.5); text-transform: capitalize; }
      .pc-cash {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 12px; font-weight: 700; color: #0B0B0B; background: #fff;
        border: 0; border-radius: 999px; padding: 6px 14px;
      }
      .pc-cash:disabled { opacity: .5; }
      .pc-foot { font-size: 11px; color: rgba(255,255,255,0.45); margin: 14px 0 0; line-height: 1.5; }

      [data-theme='light'] .pc, [data-theme='light'] .pc-empty {
        border-color: rgba(20,18,16,0.1); background: rgba(255,255,255,0.75);
      }
      [data-theme='light'] .pc-title, [data-theme='light'] .pc-empty-title, [data-theme='light'] .pc-strike { color: #1A1613; }
      [data-theme='light'] .pc-sub, [data-theme='light'] .pc-empty-sub { color: rgba(26,22,19,0.62); }
      [data-theme='light'] .pc-btn { color: rgba(26,22,19,0.75); border-color: rgba(20,18,16,0.16); }
      [data-theme='light'] .pc-btn:hover { background: rgba(20,18,16,0.05); color: #1A1613; }
      [data-theme='light'] .pc-note { color: rgba(26,22,19,0.72); }
      [data-theme='light'] .pc-row { border-color: rgba(20,18,16,0.1); }
      [data-theme='light'] .pc-stake { color: rgba(26,22,19,0.6); }
      [data-theme='light'] .pc-status { color: rgba(26,22,19,0.5); }
      [data-theme='light'] .pc-check.is-checking { color: rgba(26,22,19,0.4); }
      [data-theme='light'] .pc-cash { color: #fff; background: #1A1613; }
      [data-theme='light'] .pc-foot { color: rgba(26,22,19,0.5); }
      [data-theme='light'] .pc-when { color: rgba(26,22,19,0.4); }
      [data-theme='light'] .pc-warn { color: #9F1239; border-color: rgba(159,18,57,.2); background: rgba(159,18,57,.06); }
    `}</style>
  );
}

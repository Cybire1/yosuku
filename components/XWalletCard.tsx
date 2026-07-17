'use client';

import { useState, useEffect } from 'react';
import { Twitter, ArrowUpRight } from 'lucide-react';

type XMe = {
  handle: string | null;
  authorId?: string;
  account?: { address: string; balanceDusdc: number; owner: string | null } | null;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Portfolio card for the "trade from X" account: Connect X (links your handle via OAuth), then
// shows the tweet-funded account we made for you and its balance, with a one-tap cash-out to /claim.
export default function XWalletCard() {
  const [me, setMe] = useState<XMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/claim/x/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMe(j))
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const connected = !!me?.handle;
  const acct = me?.account ?? null;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Twitter className="h-4 w-4 text-[#E04D26]" />
        <h2 className="font-display text-sm font-[700] uppercase tracking-wide text-white">X wallet</h2>
      </div>

      <div className="rounded border border-white/[0.08] bg-bg p-5">
        {loading ? (
          <div className="text-sm text-gray-500">Checking your X connection…</div>
        ) : !connected ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold text-white">Bet straight from your tweets.</div>
              <div className="mt-1 text-sm text-gray-400">
                Connect your X to see the account we fund for you, and cash it out to any wallet anytime.
              </div>
            </div>
            <a
              href="/api/claim/x/start?return=/portfolio"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-black px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-black/85"
            >
              <Twitter className="h-4 w-4" /> Connect X
            </a>
          </div>
        ) : acct && acct.balanceDusdc > 0 ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="font-mono text-xs text-gray-400">@{me!.handle} · {short(acct.address)}</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="font-display text-3xl font-[800] text-white">${acct.balanceDusdc.toFixed(2)}</span>
                <span className="text-sm text-gray-500">in your X account</span>
              </div>
            </div>
            <a
              href="/claim"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#E04D26] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#B83A1B]"
            >
              Cash out <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        ) : (
          <div>
            <div className="font-semibold text-white">@{me!.handle} connected</div>
            <div className="mt-1 text-sm text-gray-400">
              No tweet-funded balance yet. Reply <span className="text-white/80">YES</span> or <span className="text-white/80">NO</span> to a live line to place your first bet.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

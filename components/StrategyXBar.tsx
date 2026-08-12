'use client';

import { useCallback, useEffect, useState } from 'react';
import { ConnectButton, useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit';
import { ArrowUpRight, Check, Link2, X } from 'lucide-react';
import { xLinkMessage } from '@/lib/xLink';

type XMe = {
  authorId?: string | null;
  handle?: string | null;
  signedIn?: boolean;
  binding?: { address?: string | null; handle?: string | null } | null;
};

const COPY_RETURN = '/strategies?copy=live&source=x';
const CONNECT_URL = `/api/claim/x/start?return=${encodeURIComponent(COPY_RETURN)}`;
const DISCOVER_URL = `https://x.com/search?q=${encodeURIComponent('yosuku strategy copy')}&src=typed_query&f=live`;

export default function StrategyXBar() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const [me, setMe] = useState<XMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query = address ? `?wallet=${encodeURIComponent(address)}` : '';
      const response = await fetch(`/api/claim/x/me${query}`, { cache: 'no-store' });
      setMe(response.ok ? await response.json() : null);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { void refresh(); }, [refresh]);

  const link = useCallback(async () => {
    if (!address || !me?.authorId || linking) return;
    setLinking(true);
    setError('');
    try {
      const { signature } = await signPersonalMessage({
        message: xLinkMessage(me.authorId, address),
      });
      const response = await fetch('/api/claim/x/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: address, signature }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(typeof body?.reason === 'string' ? body.reason : 'Could not link X');
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Could not link X');
    } finally {
      setLinking(false);
    }
  }, [address, linking, me?.authorId, refresh, signPersonalMessage]);

  const routed = Boolean(me?.binding);
  const handle = me?.binding?.handle || me?.handle;

  return (
    <div className="mt-5 flex flex-col gap-3 border-y border-white/10 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.03]">
          <X className="h-4 w-4 text-white" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white">
            {routed && handle ? `@${handle} linked` : 'Strategies on X'}
          </p>
          <p className="truncate font-mono text-[10px] text-white/40">
            {routed ? 'Shared links open the strategy before you sign.' : 'Link your account, then discover strategies in your feed.'}
          </p>
          {error && <p className="mt-1 text-[11px] text-loss">{error}</p>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!loading && !routed && (
          me?.signedIn && address ? (
            <button
              type="button"
              onClick={link}
              disabled={linking}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-white/15 px-4 text-[12px] font-semibold text-white transition-colors hover:border-white/30 disabled:opacity-50"
            >
              <Link2 className="h-3.5 w-3.5" /> {linking ? 'Linking…' : `Link @${me.handle || 'account'}`}
            </button>
          ) : me?.signedIn ? (
            <ConnectButton
              connectText="Connect wallet"
              className="!h-9 !rounded-full !border !border-white/15 !bg-transparent !px-4 !text-[12px] !font-semibold !text-white hover:!border-white/30"
            />
          ) : (
            <a
              href={CONNECT_URL}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-white/15 px-4 text-[12px] font-semibold text-white transition-colors hover:border-white/30"
            >
              <Link2 className="h-3.5 w-3.5" /> Connect X
            </a>
          )
        )}
        {routed && (
          <span className="hidden h-9 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-profit sm:inline-flex">
            <Check className="h-3.5 w-3.5" /> linked
          </span>
        )}
        <a
          href={DISCOVER_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-full bg-vermilion px-4 text-[12px] font-semibold text-white transition-colors hover:bg-vermilion-d"
        >
          Browse on X <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

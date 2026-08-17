'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectButton, useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  RefreshCw,
  Share2,
  Twitter,
} from 'lucide-react';
import { findCreatorCode } from '@/lib/sui/creatorCode';
import { findCreatorRecoveryForLogin } from '@/lib/sui/creatorRecovery';

type Market = {
  id: string;
  cadence: string;
  expiry: number;
  minsOut: number;
  closeLabel: string;
  cutoffLabel: string;
  cutoffMs: number;
};

type StudioOptions = {
  spot: number;
  coinflip: number;
  ladder: number[];
  grid: number;
  markets: Market[];
};

type CardPreview = {
  marketId: string;
  cadence: string;
  expiry: number;
  strikeUsd: number;
  spot: number;
  closeLabel: string;
  cutoffLabel: string;
  cutoffMs: number;
  minsOut: number;
  caption: string;
  cardPngBase64: string;
};

type XBinding = {
  authorId: string;
  handle: string | null;
  address: string | null;
};

type Readiness = {
  loading: boolean;
  error: string;
  codeId: string | null;
  binding: XBinding | null;
};

const money = (value: number) => '$' + Math.round(value).toLocaleString('en-US');
const cadenceName = (value: string) => value === '1h' ? '1 hour' : value === '5m' ? '5 minutes' : value === '1m' ? '1 minute' : value;
const cadenceOrder: Record<string, number> = { '1h': 0, '5m': 1, '1m': 2 };

function base64Blob(value: string) {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

function cardFilename(preview: CardPreview) {
  return `yosuku-btc-${preview.strikeUsd}-${preview.cadence}.png`;
}

export default function CreatorCardStudio() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const [readiness, setReadiness] = useState<Readiness>({
    loading: true,
    error: '',
    codeId: null,
    binding: null,
  });
  const [options, setOptions] = useState<StudioOptions | null>(null);
  const [marketId, setMarketId] = useState('');
  const [strike, setStrike] = useState('');
  const [preview, setPreview] = useState<CardPreview | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [composeUrl, setComposeUrl] = useState('');
  const previewRequest = useRef(0);

  const checkReadiness = useCallback(async () => {
    if (!account?.address) {
      setReadiness({ loading: false, error: '', codeId: null, binding: null });
      return;
    }
    setReadiness((current) => ({ ...current, loading: true, error: '' }));
    try {
      const [recovery, directCode, xResponse] = await Promise.all([
        findCreatorRecoveryForLogin(account.address),
        findCreatorCode(client, account.address),
        fetch(`/api/claim/x/me?wallet=${encodeURIComponent(account.address)}`, { cache: 'no-store' }),
      ]);
      const xData = xResponse.ok ? await xResponse.json() as { binding?: XBinding | null } : null;
      const binding = xData?.binding?.address?.toLowerCase() === account.address.toLowerCase()
        ? xData.binding
        : null;
      setReadiness({
        loading: false,
        error: '',
        codeId: recovery?.builderCode ?? directCode,
        binding,
      });
    } catch (reason) {
      setReadiness({
        loading: false,
        error: reason instanceof Error ? reason.message : 'Could not check creator mode.',
        codeId: null,
        binding: null,
      });
    }
  }, [account?.address, client]);

  useEffect(() => {
    void checkReadiness();
  }, [checkReadiness]);

  const ready = !!account?.address && !!readiness.codeId && !!readiness.binding;

  const loadOptions = useCallback(async () => {
    if (!ready) return;
    setLoadingOptions(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/creator-card/options', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not load live markets.');
      const next = data as StudioOptions;
      const sorted = [...(next.markets || [])].sort(
        (a, b) => (cadenceOrder[a.cadence] ?? 9) - (cadenceOrder[b.cadence] ?? 9),
      );
      const defaultMarket = sorted.find((market) => market.cadence === '5m') ?? sorted[0];
      const normalized = { ...next, markets: sorted };
      setOptions(normalized);
      setMarketId((current) => sorted.some((market) => market.id === current) ? current : (defaultMarket?.id || ''));
      setStrike((current) => current || String(next.coinflip));
      if (!sorted.length) setPreview(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load live markets.');
      setOptions(null);
      setPreview(null);
    } finally {
      setLoadingOptions(false);
    }
  }, [ready]);

  useEffect(() => {
    if (ready) void loadOptions();
    else {
      setOptions(null);
      setPreview(null);
    }
  }, [ready, loadOptions]);

  useEffect(() => {
    const strikeNumber = Number(strike);
    if (!ready || !marketId || !Number.isFinite(strikeNumber) || strikeNumber <= 0) {
      setPreview(null);
      return;
    }
    const requestId = ++previewRequest.current;
    const timer = window.setTimeout(async () => {
      setRendering(true);
      setError('');
      setNotice('');
      setComposeUrl('');
      try {
        const response = await fetch('/api/creator-card/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Send the linked X handle so the card carries a "CALLED BY @them" byline. A card that
          // markets the creator gets shared; one that only markets us does not.
          body: JSON.stringify({
            marketId,
            strikeUsd: strikeNumber,
            creatorHandle: readiness.binding?.handle ?? undefined,
          }),
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'Could not render this card.');
        if (previewRequest.current === requestId) setPreview(data as CardPreview);
      } catch (reason) {
        if (previewRequest.current === requestId) {
          setPreview(null);
          setError(reason instanceof Error ? reason.message : 'Could not render this card.');
        }
      } finally {
        if (previewRequest.current === requestId) setRendering(false);
      }
    }, 320);
    return () => window.clearTimeout(timer);
    // readiness.binding.handle is in the deps on purpose: it loads asynchronously, and without it
    // the first preview renders before the handle arrives and never re-renders, so the creator
    // silently gets a card with no byline.
  }, [marketId, ready, strike, readiness.binding?.handle]);

  const selectedMarket = useMemo(
    () => options?.markets.find((market) => market.id === marketId) ?? null,
    [marketId, options?.markets],
  );

  const hasFreshPreview = useCallback(() => {
    if (!preview) return false;
    if (Date.now() < preview.cutoffMs) return true;
    setComposeUrl('');
    setError('That line just closed. Loading the next live market…');
    void loadOptions().then(() => {
      setNotice('A fresh line is ready. Review it, then share again.');
    });
    return false;
  }, [loadOptions, preview]);

  const downloadCard = useCallback(() => {
    if (!preview || !hasFreshPreview()) return;
    const link = document.createElement('a');
    link.href = `data:image/png;base64,${preview.cardPngBase64}`;
    link.download = cardFilename(preview);
    link.click();
    setNotice('Card downloaded. Attach it to the matching post copy.');
  }, [hasFreshPreview, preview]);

  const copyPost = useCallback(async () => {
    if (!preview || !hasFreshPreview()) return;
    try {
      await navigator.clipboard.writeText(preview.caption);
      setNotice('Post copy saved to your clipboard.');
    } catch {
      setNotice('Copy was blocked. Select the post text below and copy it manually.');
    }
  }, [hasFreshPreview, preview]);

  const openX = useCallback(async () => {
    if (!preview || !hasFreshPreview()) return;
    const url = `https://x.com/intent/post?text=${encodeURIComponent(preview.caption)}`;
    setComposeUrl(url);
    let copied = false;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': base64Blob(preview.cardPngBase64) }),
      ]);
      copied = true;
    } catch {
      const link = document.createElement('a');
      link.href = `data:image/png;base64,${preview.cardPngBase64}`;
      link.download = cardFilename(preview);
      link.click();
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    setNotice(
      copied
        ? 'Card copied. Paste it into the X composer, then post.'
        : 'Card downloaded. Attach it in the X composer, then post.',
    );
    if (!opened) setNotice('Your browser blocked X. Use the Open X link below.');
  }, [hasFreshPreview, preview]);

  const shareCard = useCallback(async () => {
    if (!preview || !hasFreshPreview()) return;
    const file = new File([base64Blob(preview.cardPngBase64)], cardFilename(preview), { type: 'image/png' });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      try {
        await navigator.share({ files: [file], text: preview.caption });
        setNotice('Share sheet opened with your card and post copy.');
        return;
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
      }
    }
    await openX();
  }, [hasFreshPreview, openX, preview]);

  if (!account?.address || readiness.loading || readiness.error || !readiness.codeId || !readiness.binding) {
    const gate = !account?.address
      ? {
          title: 'Connect your wallet first.',
          body: 'Creator Studio checks that the creator code belongs to you before it prepares a card.',
          action: <ConnectButton />,
        }
      : readiness.loading
        ? {
            title: 'Checking creator access…',
            body: 'Confirming your creator code and X connection.',
            action: null,
          }
        : readiness.error
          ? {
              title: 'Creator access could not be checked.',
              body: 'Your account was not changed. Try the check again.',
              action: (
                <button type="button" onClick={() => void checkReadiness()} className="cs-primary-button">
                  Try again
                </button>
              ),
            }
          : !readiness.codeId
            ? {
                title: 'Turn on creator mode first.',
                body: 'Mint your wallet-owned creator code in Portfolio, then return here to publish.',
                action: <a href="/portfolio#creator-mode" className="cs-primary-button">Set up creator mode</a>,
              }
            : {
                title: 'Link the X account you publish from.',
                body: 'The relay uses this link to route every attributed fee to your creator code.',
                action: <a href="/portfolio#x-wallet" className="cs-primary-button">Link X in Portfolio</a>,
              };

    return (
      <div className="cs-gate">
        <div className="cs-gate-mark" aria-hidden="true">YC</div>
        <h2>{gate.title}</h2>
        <p>{gate.body}</p>
        <div className="mt-6">{gate.action}</div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(310px,0.76fr)_minmax(0,1.24fr)] lg:gap-6">
      <section className="cs-panel p-5 sm:p-6" aria-labelledby="build-card-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="build-card-title" className="font-display text-xl font-[700] tracking-[-0.035em] text-[var(--cs-text)]">
              Build your line
            </h2>
            <p className="mt-1 text-[12px] text-[var(--cs-muted)]">BTC spot is {options ? money(options.spot) : 'loading'}.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadOptions()}
            disabled={loadingOptions}
            aria-label="Refresh live markets"
            className="cs-icon-button"
          >
            <RefreshCw className={`h-4 w-4 ${loadingOptions ? 'animate-spin' : ''}`} strokeWidth={1.8} />
          </button>
        </div>

        <fieldset className="mt-7">
          <legend className="cs-field-label">Market window</legend>
          {loadingOptions && !options ? (
            <div className="mt-3 grid grid-cols-3 gap-2" aria-label="Loading live markets">
              {[0, 1, 2].map((item) => <div key={item} className="h-[70px] animate-pulse rounded-[14px] bg-[var(--cs-soft)]" />)}
            </div>
          ) : options?.markets.length ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {options.markets.map((market) => {
                const active = market.id === marketId;
                return (
                  <button
                    type="button"
                    key={market.id}
                    onClick={() => setMarketId(market.id)}
                    aria-pressed={active}
                    className={`cs-market-button ${active ? 'is-active' : ''}`}
                  >
                    <span className="font-display text-[12px] font-[700]">{cadenceName(market.cadence)}</span>
                    <span className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] opacity-55">{market.closeLabel}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-[14px] bg-[var(--cs-soft)] p-4 text-[12px] leading-relaxed text-[var(--cs-muted)]">
              No live round has enough time left. Refresh in a moment.
            </div>
          )}
        </fieldset>

        <fieldset className="mt-7">
          <legend className="cs-field-label">Your BTC target</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {(options?.ladder || []).map((value) => {
              const active = Number(strike) === value;
              return (
                <button
                  type="button"
                  key={value}
                  onClick={() => setStrike(String(value))}
                  aria-pressed={active}
                  className={`cs-strike-button ${active ? 'is-active' : ''}`}
                >
                  {money(value)}
                  {value === options?.coinflip && <span>near 50%</span>}
                </button>
              );
            })}
          </div>
          <label className="mt-3 block">
            <span className="sr-only">Custom BTC target in US dollars</span>
            <div className="cs-custom-input">
              <span aria-hidden="true">$</span>
              <input
                value={strike}
                onChange={(event) => setStrike(event.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                aria-label="Custom BTC target in US dollars"
              />
              <span>custom</span>
            </div>
          </label>
        </fieldset>

        <div className="mt-7 rounded-[16px] bg-[var(--cs-soft)] p-4">
          <div className="flex items-center justify-between gap-4 text-[11px]">
            <span className="text-[var(--cs-muted)]">Betting closes</span>
            <span className="font-mono text-[var(--cs-text)]">{selectedMarket ? `${selectedMarket.cutoffLabel} UTC` : 'Not selected'}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-4 text-[11px]">
            <span className="text-[var(--cs-muted)]">Published by</span>
            <span className="font-mono text-[var(--cs-text)]">@{readiness.binding.handle || 'linked account'}</span>
          </div>
        </div>

        <p className="mt-5 text-[10px] leading-relaxed text-[var(--cs-faint)]">
          Keep the generated wording intact. The close time and @yosuku_app tag are how the relay links replies and creator earnings.
        </p>
      </section>

      <section className="cs-preview-panel" aria-labelledby="card-preview-title">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div>
            <h2 id="card-preview-title" className="font-display text-[14px] font-[700] text-[var(--cs-text)]">Your card</h2>
            <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.13em] text-[var(--cs-faint)]">
              {rendering ? 'Rendering live market' : preview ? 'Ready to publish' : 'Waiting for a live line'}
            </p>
          </div>
          {preview && !rendering && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-[650] text-profit">
              <Check className="h-3.5 w-3.5" strokeWidth={2} /> Live market matched
            </span>
          )}
        </div>

        <div className="border-y border-[var(--cs-line)] bg-[var(--cs-preview)] p-3 sm:p-5">
          <div className="relative mx-auto max-w-[760px] overflow-hidden rounded-[18px] bg-[var(--cs-soft)]">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/png;base64,${preview.cardPngBase64}`}
                alt={`Yosuku prediction card asking whether Bitcoin will be above ${money(preview.strikeUsd)} at ${preview.closeLabel}`}
                className={`block h-auto w-full transition-opacity duration-300 ${rendering ? 'opacity-35' : 'opacity-100'}`}
              />
            ) : (
              <div className="grid min-h-[280px] place-items-center px-8 text-center sm:min-h-[390px]">
                <div>
                  <div className="mx-auto h-10 w-10 rounded-full border border-[var(--cs-line-strong)]" />
                  <p className="mt-4 text-[12px] text-[var(--cs-muted)]">
                    {error || 'Choose a live market and target to render the card.'}
                  </p>
                </div>
              </div>
            )}
            {rendering && preview && (
              <div className="absolute inset-0 grid place-items-center" aria-live="polite">
                <span className="rounded-full bg-[var(--cs-surface)] px-4 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--cs-muted)] shadow-lg">
                  Updating card
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {preview && (
            <div className="rounded-[16px] bg-[var(--cs-soft)] p-4">
              <p className="whitespace-pre-wrap font-mono text-[10px] leading-[1.75] text-[var(--cs-muted)]">
                {preview.caption}
              </p>
            </div>
          )}

          {error && preview && <p className="mt-3 text-[11px] text-loss">{error}</p>}

          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <button
              type="button"
              onClick={() => void shareCard()}
              disabled={!preview || rendering}
              className="cs-share-button"
            >
              <Share2 className="h-4 w-4" strokeWidth={1.8} /> Share card
            </button>
            <button
              type="button"
              onClick={downloadCard}
              disabled={!preview || rendering}
              className="cs-secondary-button"
            >
              <Download className="h-4 w-4" strokeWidth={1.8} /> Download
            </button>
            <button
              type="button"
              onClick={() => void copyPost()}
              disabled={!preview || rendering}
              className="cs-secondary-button"
            >
              <Copy className="h-4 w-4" strokeWidth={1.8} /> Copy post
            </button>
          </div>

          <div className="mt-3 flex min-h-6 flex-wrap items-center justify-between gap-3" aria-live="polite">
            <p className="text-[10px] leading-relaxed text-[var(--cs-muted)]">{notice}</p>
            {composeUrl && (
              <a href={composeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[10px] font-[650] text-vermilion">
                <Twitter className="h-3.5 w-3.5" strokeWidth={1.8} /> Open X <ArrowUpRight className="h-3 w-3" strokeWidth={1.8} />
              </a>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

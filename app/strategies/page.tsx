'use client';

import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useCurrentAccount, useSuiClient, useSignPersonalMessage, ConnectButton } from '@mysten/dapp-kit';
import { Share2, X, Lock, ArrowRight, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import { useToast } from '@/components/Toast';
import { useDUSDCBalance } from '@/lib/sui/hooks';
import {
  fetchStrategies,
  fetchCopyTrades,
  fetchStrategySubscriptions,
  buildFundAndSubscribeTx,
  buildListStrategyTx,
  buildCancelSubscriptionTx,
  buildStrategyShareText,
  fetchSocialVaultBalance,
  strategyIdFromDigest,
  recordAgentSpec,
  describeSpec,
  ATTESTED_AGENT,
  PRESETS,
  fmtDusdc,
  fmtAddr,
  ago,
  codenameFromAddress,
  glyphFromAddress,
  SUISCAN_TX,
  SUISCAN_ACC,
  xIntentUrl,
  type StrategyCard,
  type CopyTrade,
  type StrategySubscription,
  type PresetKey,
  type StrategySpec,
} from '@/lib/sui/strategyClient';
import { fetchMemoryMarket, fetchAllMemoryListings, buildBuyPassTx, readMemory, type MemoryMarketInfo, type MemoryListingCard } from '@/lib/sui/memoryMarketClient';
import LiveDesk from '@/components/LiveDesk';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { getSponsorStatus, type SponsorStatus } from '@/lib/sponsor';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000000';
const SUISCAN_OBJ = (id: string) => `https://suiscan.xyz/testnet/object/${id}`;
const DAY = 86_400_000;

// Deterministic kanji glyph tile per strategy — the desk's own visual language.
// (Photo portraits looked like fake people, and a 5-image pool guaranteed duplicate
// faces side-by-side in an 8-card grid. A seeded glyph is unique, honest, on-brand.)
function AgentPortrait({ seed, name, size = 'card' }: { seed: string; name: string; size?: 'small' | 'card' | 'drawer' }) {
  const dimensions = size === 'small' ? 'h-8 w-8 text-base' : size === 'drawer' ? 'h-16 w-16 text-3xl' : 'h-16 w-16 text-3xl';
  return (
    <div
      aria-label={`${name} agent glyph`}
      className={`relative shrink-0 grid place-items-center overflow-hidden border border-white/10 bg-white/[0.03] font-jp text-vermilion ${dimensions}`}
    >
      {glyphFromAddress(seed)}
      <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full border border-black/70 bg-vermilion shadow-[0_0_8px_rgba(224,77,38,0.8)]" />
    </div>
  );
}

type Tier = { key: 'new' | 'active' | 'settled'; label: string; tone: 'gray' | 'vermilion' | 'white' };

// Honest tiers. "Settled" means it has CLOSED, on-chain P&L (win OR loss) — it never implies
// profit; the realized number itself carries the sign. Never a red "unproven" on a clean new agent.
function tierOf(c: StrategyCard): Tier {
  if (c.realizedTrades > 0) return { key: 'settled', label: `Settled · ${c.realizedTrades} closed`, tone: 'white' };
  if (c.copyTrades >= 1) return { key: 'active', label: `Active · ${c.copyTrades} copy-trades`, tone: 'vermilion' };
  return { key: 'new', label: 'New · no track record yet', tone: 'gray' };
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'settled', label: 'Settled' },
  { key: 'memwal', label: 'Has memory' },
  { key: 'copied', label: 'Most copied' },
  { key: 'safest', label: 'Safest' },
  { key: 'new', label: 'New' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function filterSort(list: StrategyCard[], tab: TabKey): StrategyCard[] {
  let out = [...list];
  if (tab === 'settled') out = out.filter((c) => tierOf(c).key === 'settled');
  else if (tab === 'new') out = out.filter((c) => tierOf(c).key === 'new');
  else if (tab === 'memwal') out = out.filter((c) => c.hasMemory);
  const settledFirst = (a: StrategyCard, b: StrategyCard) =>
    (tierOf(b).key === 'settled' ? 1 : 0) - (tierOf(a).key === 'settled' ? 1 : 0);
  if (tab === 'copied') out.sort((a, b) => b.subscribers - a.subscribers || b.copyTrades - a.copyTrades);
  else if (tab === 'safest') out.sort((a, b) => a.maxLeverage - b.maxLeverage || a.maxMargin - b.maxMargin);
  else out.sort((a, b) => settledFirst(a, b) || b.copyTrades - a.copyTrades || b.subscribers - a.subscribers);
  return out;
}

export default function StrategiesPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { coins: dusdcCoins, refresh: refreshDusdc } = useDUSDCBalance();
  const { toast } = useToast();
  const { submit } = useSmartSubmit();
  const suiClient = useSuiClient();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const [strategies, setStrategies] = useState<StrategyCard[]>([]);
  const [copyTrades, setCopyTrades] = useState<CopyTrade[]>([]);
  const [subscriptions, setSubscriptions] = useState<StrategySubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sponsor, setSponsor] = useState<SponsorStatus | null>(null);
  const [subscribingId, setSubscribingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [socialVaultBalance, setSocialVaultBalance] = useState(0);

  const [tab, setTab] = useState<TabKey>('all');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [budget, setBudget] = useState(''); // copy-budget in the drawer (additive, never forced)
  const [memoryInfo, setMemoryInfo] = useState<MemoryMarketInfo | null>(null);
  const [buyingMemory, setBuyingMemory] = useState(false);
  const [memoryText, setMemoryText] = useState<string | null>(null);
  const [readingMemory, setReadingMemory] = useState(false);

  // creator: "launch an agent" flow — pick a preset, turn two knobs, set hard caps, publish.
  const [showList, setShowList] = useState(false);
  const [listing, setListing] = useState(false);
  const [form, setForm] = useState({
    preset: 'momentum' as PresetKey,
    lookback: 6,          // # of 15-min samples the enclave reads (2–12)
    thresholdPct: '0.2',  // minimum BTC move to act on
    hosting: 'attested' as 'attested' | 'self',
    agent: '',            // self-host only: the creator's own bot wallet
    maxLeverage: '3',
    maxMargin: '5',
    subFee: '0.1',
  });
  const draftSpec: StrategySpec = {
    preset: form.preset,
    lookback: form.lookback,
    thresholdBps: Math.round((parseFloat(form.thresholdPct) || 0) * 100),
  };

  // ── Memory Market storefront (Own an agent's mind) ──
  const [listings, setListings] = useState<MemoryListingCard[]>([]);
  const [mktBusy, setMktBusy] = useState<string | null>(null);     // listingId being bought/read
  const [mktText, setMktText] = useState<Record<string, string>>({}); // listingId → decrypted playbook
  const refreshListings = useCallback(() => {
    fetchAllMemoryListings(address).then(setListings).catch(() => {});
  }, [address]);
  useEffect(() => { refreshListings(); }, [refreshListings]);

  const buyListing = useCallback(async (l: MemoryListingCard) => {
    if (!address) return;
    const priceMicro = BigInt(Math.round(l.price * DUSDC_MULTIPLIER));
    const haveMicro = dusdcCoins.reduce((s, c) => s + c.balance, BigInt(0));
    if (haveMicro < priceMicro) { toast(`Wallet needs ${l.price} test USDC for this pass`, 'error'); return; }
    setMktBusy(`buy:${l.listingId}`);
    try {
      await submit(() => buildBuyPassTx({ listingId: l.listingId, coinIds: dusdcCoins.map((c) => c.coinObjectId), priceMicro, owner: address }));
      toast('Pass acquired — decrypt the playbook', 'success');
      refreshDusdc(); refreshListings();
    } catch (e) { toast(`Couldn't buy: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`, 'error'); }
    finally { setMktBusy(null); }
  }, [address, dusdcCoins, submit, refreshDusdc, refreshListings, toast]);

  const readListing = useCallback(async (l: MemoryListingCard) => {
    if (!address || !l.passId) return;
    setMktBusy(`read:${l.listingId}`);
    try {
      const text = await readMemory({ suiClient, walletAddress: address, listingId: l.listingId, passId: l.passId, signPersonalMessage });
      setMktText((m) => ({ ...m, [l.listingId]: text }));
    } catch (e) { toast(`Couldn't decrypt: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`, 'error'); }
    finally { setMktBusy(null); }
  }, [address, suiClient, signPersonalMessage, toast]);

  const subscriptionByStrategy = useMemo(
    () => new Map(subscriptions.map((sub) => [sub.strategy, sub])),
    [subscriptions],
  );
  const visible = useMemo(() => filterSort(strategies, tab), [strategies, tab]);
  const totalCopiers = strategies.reduce((s, c) => s + (c.subscribers || 0), 0);
  const drawerCard = drawerId ? strategies.find((s) => s.id === drawerId) ?? null : null;
  const walletDusdc = dusdcCoins.reduce((s, c) => s + c.balance, BigInt(0));
  const walletDusdcNum = Number(walletDusdc) / DUSDC_MULTIPLIER;
  const currentVaultDusdc = socialVaultBalance / DUSDC_MULTIPLIER;
  const tabCount = (k: TabKey) => filterSort(strategies, k).length;

  function postToX(text: string) {
    window.open(xIntentUrl(text), '_blank', 'noopener,noreferrer');
  }

  const refreshSocialVaultBalance = useCallback(async () => {
    if (!address) return setSocialVaultBalance(0);
    try { setSocialVaultBalance(await fetchSocialVaultBalance(address)); } catch { setSocialVaultBalance(0); }
  }, [address]);

  const refreshSubscriptions = useCallback(async () => {
    if (!address) return setSubscriptions([]);
    try { setSubscriptions(await fetchStrategySubscriptions(address)); } catch { setSubscriptions([]); }
  }, [address]);

  useEffect(() => { getSponsorStatus().then(setSponsor).catch(() => {}); }, []);

  useEffect(() => {
    if (address && !form.agent) setForm((f) => ({ ...f, agent: address }));
  }, [address, form.agent]);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([fetchStrategies(), fetchCopyTrades(50)]);
      setStrategies(s); setCopyTrades(t); setLoadError(null);
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    refreshSocialVaultBalance(); refreshSubscriptions();
    const id = setInterval(() => { refreshSocialVaultBalance(); refreshSubscriptions(); }, 20_000);
    return () => clearInterval(id);
  }, [refreshSocialVaultBalance, refreshSubscriptions]);

  // open/close the copy drawer: reset budget, lock scroll, Esc to close.
  const openDrawer = (id: string) => { setBudget(''); setMemoryText(null); setDrawerId(id); };
  // Archived-catalogue CTAs send copiers up to the (only) live venue instead of a dead subscribe.
  const scrollToDesk = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    document.getElementById('live-desk')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const closeDrawer = useCallback(() => setDrawerId(null), []);
  useEffect(() => {
    if (!drawerId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey); };
  }, [drawerId, closeDrawer]);

  // memory market: is this agent's memory for sale, and do you already hold a pass?
  useEffect(() => {
    if (!drawerId) { setMemoryInfo(null); return; }
    let live = true;
    fetchMemoryMarket(drawerId, address).then((m) => { if (live) setMemoryInfo(m); });
    return () => { live = false; };
  }, [drawerId, address]);

  async function buyMemoryPass() {
    if (!address || !memoryInfo || !drawerId) return;
    const priceMicro = BigInt(Math.round(memoryInfo.price * DUSDC_MULTIPLIER));
    const walletMicro = dusdcCoins.reduce((s, c) => s + c.balance, BigInt(0));
    if (walletMicro < priceMicro) { toast(`Wallet balance too low — needs ${memoryInfo.price} test USDC for the memory pass`, 'error'); return; }
    setBuyingMemory(true);
    try {
      await submit(() => buildBuyPassTx({ listingId: memoryInfo.listingId, coinIds: dusdcCoins.map((c) => c.coinObjectId), priceMicro, owner: address }));
      toast('Memory Pass bought', 'success');
      setMemoryInfo(await fetchMemoryMarket(drawerId, address));
      refreshDusdc();
    } catch (e) {
      toast(`Could not buy memory: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setBuyingMemory(false); }
  }

  async function readMemoryHandler() {
    if (!address || !memoryInfo?.passId) return;
    setReadingMemory(true);
    try {
      const text = await readMemory({ suiClient, walletAddress: address, listingId: memoryInfo.listingId, passId: memoryInfo.passId, signPersonalMessage });
      setMemoryText(text);
    } catch (e) {
      toast(`Couldn't read the playbook: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setReadingMemory(false); }
  }

  // Subscriber: top up the capped budget + authorize the agent to copy-trade under hard caps.
  async function subscribe(card: StrategyCard, budgetStr: string) {
    if (!address) return;
    const target = Number(budgetStr.replace(',', '.'));
    if (!Number.isFinite(target) || target <= 0) { toast('Enter a copy budget above 0', 'error'); return; }
    const targetMicro = BigInt(Math.floor(target * DUSDC_MULTIPLIER));
    const currentMicro = BigInt(Math.floor(socialVaultBalance));
    const topUpMicro = targetMicro > currentMicro ? targetMicro - currentMicro : BigInt(0);
    const feeMicro = BigInt(Math.floor(card.subFee * DUSDC_MULTIPLIER));
    const needed = topUpMicro + feeMicro;
    if (walletDusdc < needed) {
      toast(`Wallet balance too low — needs ${(Number(needed) / DUSDC_MULTIPLIER).toFixed(2)} test USDC for budget + fee`, 'error');
      return;
    }
    setSubscribingId(card.id);
    try {
      await submit(() => buildFundAndSubscribeTx({
        owner: address, strategyId: card.id,
        coinIds: dusdcCoins.map((c) => c.coinObjectId),
        topUpMicro, subFeeMicro: feeMicro,
      }));
      toast(`Now copying ${codenameFromAddress(card.id)}`, 'success');
      closeDrawer();
      await load(); refreshSocialVaultBalance(); refreshSubscriptions(); refreshDusdc();
    } catch (e) {
      toast(`Could not start copying: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setSubscribingId(null); }
  }

  async function cancelSubscription(sub: StrategySubscription) {
    if (!address || cancelingId) return;
    setCancelingId(sub.id);
    try {
      await submit(() => buildCancelSubscriptionTx(sub.id));
      toast(`Paused future copies for ${codenameFromAddress(sub.strategy)}`, 'success');
      refreshSubscriptions();
    } catch (e) {
      toast(`Pause failed: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setCancelingId(null); }
  }

  async function listStrategy() {
    if (!address) return;
    const maxLeverageBps = Math.round(parseFloat(form.maxLeverage || '0') * 10_000);
    const maxMarginMicro = BigInt(Math.floor(parseFloat(form.maxMargin || '0') * DUSDC_MULTIPLIER));
    const subFeeMicro = BigInt(Math.floor(parseFloat(form.subFee || '0') * DUSDC_MULTIPLIER));
    const attested = form.hosting === 'attested';
    // Attested → the agent IS the sealed enclave; it runs the spec inside the TEE.
    // Self-host → the creator's own bot wallet signs (advanced).
    const agent = attested ? ATTESTED_AGENT : (form.agent.trim() || address);
    if (maxLeverageBps < 10_000) { toast('Most leverage must be at least 1×', 'error'); return; }
    if (maxMarginMicro <= BigInt(0)) { toast('Most per trade must be greater than 0', 'error'); return; }
    if (!attested && !/^0x[0-9a-fA-F]{64}$/.test(agent)) { toast('Agent wallet must be a 0x… address', 'error'); return; }
    setListing(true);
    try {
      const { digest } = await submit(() =>
        buildListStrategyTx({ agent, capsuleBlob: BigInt(0), memoryAccount: ZERO_ADDR, maxLeverageBps, maxMarginMicro, subFeeMicro, creator: address }));
      // Register the direction logic with the attested keeper (caps are already on-chain).
      if (attested) {
        const strategyId = await strategyIdFromDigest(digest);
        if (strategyId) {
          try {
            await recordAgentSpec({ strategyId, agent, spec: draftSpec, creator: address });
            toast('Agent listed on Sui. It starts trading once the desk picks it up.', 'success');
          } catch {
            toast('Agent listed on Sui. Sealed-hardware execution activates once the keeper picks up its spec.', 'success');
          }
        } else {
          toast('Agent listed on Sui — indexing. It will appear in the catalogue shortly.', 'success');
        }
      } else {
        toast('Strategy published — users can now copy it.', 'success');
      }
      setShowList(false); await load();
    } catch (e) {
      toast(`Publish failed: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setListing(false); }
  }

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="container pt-[120px] pb-12">
        {/* masthead — dateline with live counts */}
        <div className="border-t border-white/10 pt-3 flex items-center justify-between gap-4 font-mono text-[10px] md:text-[11px] uppercase tracking-[0.28em] text-white/40">
          <span><span className="text-vermilion">⊙</span> Yosuku Ledger · <span className="font-jp">戦略</span></span>
          <span className="tabular-nums flex items-center gap-2">
            <span className="hidden sm:inline">Est. on Sui ·</span>
            <span className="text-white">{strategies.length}</span> listed
            <span className="text-white/20">·</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-vermilion animate-pulse" /><span className="text-white">{totalCopiers}</span> copying</span>
          </span>
        </div>

        {/* nameplate — one headline idea, full-width for air. Custody is carried ONCE by the
            desk's own anchor line; no re-teaching here. */}
        <div className="mt-7 pb-7 border-b border-white/15">
          <h1 className="font-display font-[800] text-[2.5rem] leading-[0.92] md:text-[4.25rem] xl:text-[5.25rem] text-white tracking-tight max-w-5xl">
            Copy a strategy.<br /><span className="text-white/60">Keep your money.</span>
          </h1>
        </div>

        {/* ── THE LIVE DESK — copy-trading on the NEW venue (vault624 on predict-testnet-6-24) ── */}
        {/* pb keeps the manage chips clear of the fixed mobile bottom nav */}
        <div id="live-desk" className="pb-24 sm:pb-0">
          <LiveDesk />
        </div>

        {/* ── THE MEMORY MARKET — Own an agent's mind (buy the pass, decrypt the playbook) ── */}
        <MemoryMarket
          listings={listings}
          strategies={strategies}
          address={address}
          busy={mktBusy}
          text={mktText}
          onBuy={buyListing}
          onRead={readListing}
        />

        {/* previous-venue dateline — the catalogue below is real history on the old deployment */}
        <div className="flex items-center gap-3 mt-14 mb-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">Previous venue — records preserved</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        {/* control bar — curated tabs (replaces the dead leaderboard) */}
        <div className="sticky top-[64px] z-20 -mx-4 px-4 py-3 mb-7 bg-bg/85 backdrop-blur-md border-b border-white/[0.06]">
          <div className="flex items-center gap-5 overflow-x-auto no-scrollbar">
            {TABS.map((t) => {
              const on = tab === t.key;
              const n = tabCount(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`shrink-0 px-1 pb-2 font-mono text-[11px] uppercase tracking-[0.12em] border-b-2 transition-colors ${
                    on ? 'text-white border-vermilion' : 'text-white/40 hover:text-white border-transparent'
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 tabular-nums ${on ? 'text-white/30' : 'text-white/20'}`}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loading && strategies.length === 0 ? (
          <div className="font-mono text-sm text-gray-500 py-24 text-center">reading the chain…</div>
        ) : (
          <>
            {/* 01 — the marketplace grid (primary) */}
            {visible.length === 0 ? (
              <div className="border border-white/[0.08] bg-white/[0.02] p-16 text-center">
                <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40 mb-4"><span className="text-vermilion">⊙</span> Yosuku Ledger</div>
                <h2 className="font-display font-[800] text-2xl text-white mb-2">
                  {strategies.length === 0 ? 'No editions filed yet' : `No ${tab} agents`}
                </h2>
                <p className="text-white/40 text-sm max-w-md mx-auto leading-relaxed">
                  {loadError
                    ? "Couldn't reach the chain — retrying every 30s."
                    : strategies.length === 0
                      ? 'Copyable agents appear here the moment a creator publishes one. Every agent is bound to hard risk caps on Sui before a dollar of yours can move.'
                      : 'Nothing matches this filter yet — try another tab.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-white/[0.06] border border-white/[0.06]">
                {visible.map((card, i) => {
                  const tier = tierOf(card);
                  const sub = subscriptionByStrategy.get(card.id);
                  const folio = String(i + 1).padStart(2, '0');
                  const agentName = codenameFromAddress(card.id);
                  return (
                    <div
                      key={card.id}
                      id={`strategy-${card.id}`}
                      className="group relative bg-bg p-5 flex flex-col transition-colors duration-200 hover:bg-white/[0.02]"
                    >
                      <Crosshairs />

                      {/* dateline: folio · tier — last filed */}
                      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.25em] pb-3 mb-4 border-b border-white/[0.08]">
                        <span className="flex items-center gap-3">
                          <span className="text-white/30">Nº {folio}</span>
                          <TierWord tier={tier} />
                        </span>
                        <span className="text-white/40">{ago(card.lastActive) || '—'}</span>
                      </div>

                      {/* Strategy identity is seeded from the strategy object, not the shared executor. */}
                      <div className="flex items-start gap-3">
                        <AgentPortrait seed={card.id} name={agentName} />
                        <div className="min-w-0 flex-1 pt-1">
                          <h3 className="font-display font-[800] text-xl text-white truncate tracking-tight leading-[1.05]">{agentName}</h3>
                          <a href={SUISCAN_ACC(card.agent)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                            className="mt-1 inline-block font-mono text-[10px] uppercase tracking-[0.12em] text-white/35 hover:text-white transition-colors">On-chain record ↗</a>
                        </div>
                      </div>

                      {/* filed stamps — agent memory / Walrus playbook */}
                      {(card.hasMemory || card.hasCapsule) && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {card.hasMemory && (
                            <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-vermilion border border-vermilion/40 px-2 py-1">◈ Agent memory</span>
                          )}
                          {card.hasCapsule && (
                            <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 border border-white/15 px-2 py-1">▤ Walrus playbook</span>
                          )}
                        </div>
                      )}

                      {/* leverage pull-quote — the focal mass that carries sparse cards */}
                      <div className="border-l-2 border-vermilion pl-3 my-5">
                        <div className="font-display font-[800] text-3xl text-white leading-none tabular-nums">{card.maxLeverage}<span className="text-vermilion">×</span></div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40 mt-1.5">Most leverage</div>
                      </div>

                      {/* ruled stat table */}
                      <div className="grid grid-cols-3 border-y border-white/[0.08]">
                        <LedgerStat label="Most per trade" value={`${fmtDusdc(card.maxMargin)}`} />
                        <LedgerStat label="Fee" value={card.subFee === 0 ? 'Free' : fmtDusdc(card.subFee)} divide />
                        <LedgerStat label="Copiers" value={card.subscribers > 0 ? String(card.subscribers) : '—'} divide />
                      </div>

                      {/* record line — never blank */}
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] py-4 mb-1">
                        {card.copyTrades > 0 ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-white/60 tabular-nums">{card.copyTrades} copy-trades</span>
                            {card.realizedTrades > 0 && (
                              <>
                                <span className="text-white/20">·</span>
                                <span className="text-white tabular-nums">{card.realizedPnl >= 0 ? '▲' : '▼'} {card.realizedPnl >= 0 ? '+' : ''}{fmtDusdc(card.realizedPnl)}</span>
                              </>
                            )}
                          </span>
                        ) : (
                          <span className="text-white/40 tracking-[0.22em]">[ Awaiting first copy ]</span>
                        )}
                      </div>

                      {/* CTA */}
                      <div className="mt-auto">
                        {sub ? (
                          // Existing subscribers keep an entry point to view / withdraw their position.
                          <button onClick={() => openDrawer(card.id)}
                            className="w-full py-3 font-mono text-[11px] uppercase tracking-[0.14em] font-semibold border border-white/20 text-white hover:border-white/40 hover:bg-white/[0.03] transition-colors inline-flex items-center justify-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-vermilion" /> Your position — manage
                          </button>
                        ) : (
                          // Read-only archive: the old keeper only fans one strategy, so a new "Copy"
                          // here would take a fee and never fill. Send new copiers to the Live Desk.
                          <a href="#live-desk" onClick={scrollToDesk}
                            className="group/cta w-full py-3 font-mono text-[11px] uppercase tracking-[0.14em] font-semibold border border-white/12 text-white/55 hover:text-white hover:border-white/30 transition-colors inline-flex items-center justify-center gap-2">
                            Archived record · copy live on the desk <span className="transition-transform group-hover/cta:-translate-y-0.5">↑</span>
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 02 — recent copy-trades (slimmed; liveness + on-chain proof) */}
            <section className="mt-14">
              <div className="flex items-center gap-3 mb-4">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">Recent copy-trades</h2>
                <div className="h-px flex-1 bg-white/10" />
                <span className="font-mono text-[11px] text-white/30 tabular-nums">{copyTrades.length}</span>
              </div>
              <div className="border border-white/[0.08] bg-bg divide-y divide-white/[0.05] overflow-hidden">
                {copyTrades.length === 0 ? (
                  <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/30 px-5 py-8 text-center">No copy-trades settled yet — be the first.</div>
                ) : (
                  copyTrades.map((t, i) => {
                    const tradeName = codenameFromAddress(t.strategy || t.agent);
                    const inner = (
                      <div className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                        <AgentPortrait seed={t.strategy || t.agent} name={tradeName} size="small" />
                        <span className="font-display font-[700] text-[13px] text-white w-28 shrink-0 truncate">{tradeName}</span>
                        <a
                          href={SUISCAN_ACC(t.subscriber)} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-[12px] text-white/40 hover:text-white transition-colors hidden sm:inline"
                        >
                          {fmtAddr(t.subscriber)}
                        </a>
                        <span className="flex-1" />
                        <span className="font-mono text-[12px] text-white/70 tabular-nums">{fmtDusdc(t.notional)} test USDC</span>
                        <span className="font-mono text-[11px] text-white/40 w-10 text-right shrink-0 tabular-nums">{t.leverageBps / 10000}×</span>
                        <span className="font-mono text-[11px] text-white/30 w-14 text-right shrink-0">{ago(t.ts)}</span>
                        <span className="font-mono text-[11px] text-vermilion w-4 text-right shrink-0">{t.digest ? '↗' : ''}</span>
                      </div>
                    );
                    const txHref = t.digest ? SUISCAN_TX(t.digest) : null;
                    return txHref ? (
                      <div
                        key={i} role="link" tabIndex={0}
                        onClick={() => window.open(txHref, '_blank', 'noopener,noreferrer')}
                        onKeyDown={(e) => { if (e.key === 'Enter') window.open(txHref, '_blank', 'noopener,noreferrer'); }}
                        className="block cursor-pointer"
                      >
                        {inner}
                      </div>
                    ) : (
                      <div key={i}>{inner}</div>
                    );
                  })
                )}
              </div>
            </section>

            {/* ── creator studio: launch an attested agent ── */}
            <section className="mt-14">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-4">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion mb-1.5">Creator studio</div>
                  <h2 className="font-display font-[800] text-2xl sm:text-[26px] text-white leading-none">Launch an agent</h2>
                  <p className="text-[13px] text-gray-400 mt-2.5 max-w-md leading-snug">
                    Pick a strategy, set the caps it can never cross, publish. It runs on autopilot, and the
                    vault contract on Sui enforces the caps — it can trade your copiers&apos; funds, never take them.
                  </p>
                </div>
                {address ? (
                  <button
                    onClick={() => setShowList((v) => !v)}
                    className="shrink-0 rounded-full border border-vermilion/40 bg-vermilion/[0.07] px-5 py-2.5 text-[13px] font-semibold text-vermilion hover:bg-vermilion/[0.14] transition-colors"
                  >
                    {showList ? '× Close' : 'Launch an agent →'}
                  </button>
                ) : (
                  <span className="shrink-0 font-mono text-[12px] text-gray-600">Connect a wallet to launch.</span>
                )}
              </div>

              {address && showList && (
                <div className="mt-7 grid lg:grid-cols-[1fr_20rem] gap-7 items-start">
                  {/* the builder */}
                  <div className="space-y-8">
                    {/* 01 — strategy */}
                    <StudioStep n="01" title="Strategy" hint="the instinct it trades on">
                      <div className="grid sm:grid-cols-2 gap-3">
                        {(Object.keys(PRESETS) as PresetKey[]).map((k) => {
                          const p = PRESETS[k];
                          const active = form.preset === k;
                          const comingSoon = k === 'reversion'; // enclave honors the momentum rule only today
                          return (
                            <button
                              key={k} type="button"
                              aria-disabled={comingSoon}
                              onClick={() => { if (!comingSoon) setForm((f) => ({ ...f, preset: k })); }}
                              className={`group relative text-left rounded-xl border p-4 transition-colors ${comingSoon ? 'border-white/[0.06] opacity-60 cursor-not-allowed' : active ? 'border-vermilion bg-vermilion/[0.06]' : 'border-white/[0.08] hover:border-white/20'}`}
                            >
                              <Crosshairs />
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="font-display font-[700] text-[15px] text-white">{p.name}</span>
                                <span className={`font-mono text-[9px] uppercase tracking-[0.16em] ${active ? 'text-vermilion' : 'text-white/30'}`}>{active ? 'Selected' : p.tagline}</span>
                              </div>
                              <p className="text-[12px] text-gray-400 leading-snug mt-2">{p.how}</p>
                              {comingSoon && (
                                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/30 mt-2">Soon — momentum runs today</div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </StudioStep>

                    {/* 02 — tune */}
                    <StudioStep n="02" title="Tune" hint="two knobs — everything else is fixed and reviewed">
                      <div className="grid sm:grid-cols-2 gap-5">
                        <div>
                          <div className="flex items-baseline justify-between mb-2">
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Lookback</span>
                            <span className="font-mono text-[12px] text-white tabular-nums">{form.lookback}<span className="text-white/40"> × 15m</span></span>
                          </div>
                          <input type="range" min={2} max={12} step={1} value={form.lookback}
                            onChange={(e) => setForm((f) => ({ ...f, lookback: Number(e.target.value) }))}
                            className="w-full accent-vermilion" />
                          <div className="font-mono text-[10px] text-white/30 mt-1">how far back it reads</div>
                        </div>
                        <div>
                          <div className="flex items-baseline justify-between mb-2">
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Threshold</span>
                            <span className="font-mono text-[12px] text-white tabular-nums">{form.thresholdPct || '0'}%</span>
                          </div>
                          <div className="flex gap-1.5">
                            {['0.1', '0.2', '0.5', '1'].map((v) => (
                              <button key={v} type="button" onClick={() => setForm((f) => ({ ...f, thresholdPct: v }))}
                                className={`flex-1 py-1.5 rounded font-mono text-[11px] border transition-colors ${form.thresholdPct === v ? 'border-vermilion text-vermilion bg-vermilion/[0.06]' : 'border-white/[0.08] text-white/50 hover:border-white/20'}`}>{v}%</button>
                            ))}
                          </div>
                          <div className="font-mono text-[10px] text-white/30 mt-1.5">smallest move worth a bet</div>
                        </div>
                      </div>
                      <div className="mt-4 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3">
                        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-vermilion mb-1.5">In plain words</div>
                        <p className="text-[13px] text-gray-200 leading-snug">{describeSpec(draftSpec)}</p>
                      </div>
                    </StudioStep>

                    {/* 03 — hard caps */}
                    <StudioStep n="03" title="Hard limits" hint="the ceilings it is bound to on Sui — forever">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <Field label="Most leverage">
                          <div className="flex gap-1.5">
                            {['1', '2', '3', '5', '10'].map((v) => (
                              <button key={v} type="button" onClick={() => setForm((f) => ({ ...f, maxLeverage: v }))}
                                className={`flex-1 py-2 rounded font-mono text-[11px] border transition-colors ${form.maxLeverage === v ? 'border-vermilion text-vermilion bg-vermilion/[0.06]' : 'border-white/[0.08] text-white/50 hover:border-white/20'}`}>{v}×</button>
                            ))}
                          </div>
                        </Field>
                        <Field label="Most per trade (test USDC)">
                          <input type="number" min="0" step="1" value={form.maxMargin} onChange={(e) => setForm((f) => ({ ...f, maxMargin: e.target.value }))} className={INPUT_NUM} />
                        </Field>
                        <Field label="Subscription fee (test USDC)">
                          <input type="number" min="0" step="0.1" value={form.subFee} onChange={(e) => setForm((f) => ({ ...f, subFee: e.target.value }))} className={INPUT_NUM} />
                        </Field>
                      </div>
                    </StudioStep>

                    {/* 04 — who runs it */}
                    <StudioStep n="04" title="Who runs it">
                      <div className="grid sm:grid-cols-2 gap-3">
                        <HostingOption active={form.hosting === 'attested'} onClick={() => setForm((f) => ({ ...f, hosting: 'attested' }))}
                          badge="Recommended" title="Let Yosuku run it"
                          body="Yosuku runs it for you, hands-off. Your caps live in the Sui contract — it can trade copiers' funds, never take them." />
                        <HostingOption active={form.hosting === 'self'} onClick={() => setForm((f) => ({ ...f, hosting: 'self' }))}
                          badge="Advanced" title="Run your own bot"
                          body="You host the agent and hold its key. Register its wallet; it copies under the same limits enforced on Sui." />
                      </div>
                      {form.hosting === 'self' && (
                        <div className="mt-3 max-w-sm">
                          <Field label="Agent wallet">
                            <input value={form.agent} onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))} placeholder="0x… your bot's address" className={INPUT} />
                          </Field>
                        </div>
                      )}
                    </StudioStep>
                  </div>

                  {/* live preview + publish (sticky) */}
                  <aside className="lg:sticky lg:top-24 space-y-4">
                    <div className="group relative rounded-xl border border-white/[0.1] bg-bg p-5 overflow-hidden">
                      <Crosshairs />
                      <div className="flex items-center justify-between">
                        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">Preview</div>
                        {form.hosting === 'attested' && (
                          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-vermilion border border-vermilion/40 rounded-full px-2 py-0.5">⊙ Autopilot</span>
                        )}
                      </div>
                      {(() => {
                        const previewAgent = form.hosting === 'attested' ? ATTESTED_AGENT : (form.agent.trim() || address || ZERO_ADDR);
                        const valid = /^0x[0-9a-fA-F]{64}$/.test(previewAgent);
                        const previewSeed = `${previewAgent}:${form.preset}:${form.lookback}:${form.thresholdPct}`;
                        const previewName = valid ? codenameFromAddress(previewSeed) : 'Your agent';
                        return (
                          <div className="mt-3 flex items-center gap-3">
                            {valid ? <AgentPortrait seed={previewSeed} name={previewName} size="small" /> : <span className="text-2xl leading-none">—</span>}
                            <div className="min-w-0">
                              <div className="font-display font-[700] text-[15px] text-white truncate">{previewName}</div>
                              <div className="font-mono text-[10px] text-white/40">{PRESETS[form.preset].name} · {form.maxLeverage}× cap</div>
                            </div>
                          </div>
                        );
                      })()}
                      <div className="grid grid-cols-2 mt-4 border-t border-white/[0.08]">
                        <LedgerStat label="Most per trade" value={`${form.maxMargin || '0'}`} />
                        <LedgerStat label="Sub fee" value={`${form.subFee || '0'}`} divide />
                      </div>
                      <p className="text-[12px] text-gray-400 leading-snug mt-4">{describeSpec(draftSpec)}</p>
                    </div>

                    <button
                      onClick={listStrategy} disabled={listing}
                      className="w-full py-3 rounded-full text-sm font-semibold bg-vermilion hover:bg-vermilion-d text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {listing ? 'launching…' : form.hosting === 'attested' ? 'Launch enclave agent' : 'Publish strategy'}
                    </button>
                    <p className="font-mono text-[10px] leading-relaxed text-gray-600">
                      Limits are enforced on Sui. The agent trades only inside them and can never withdraw a copier&apos;s funds.
                    </p>
                  </aside>
                </div>
              )}
            </section>

            {/* standing disclosure */}
            <p className="mt-10 font-mono text-[10px] leading-relaxed text-gray-600 max-w-2xl">
              Agents trade test USDC on Sui testnet, on 15-min Bitcoin up/down markets. You can lose your full budget. The agent
              cannot withdraw or divert it — verify every position on Sui.
            </p>
          </>
        )}

        <Footer />
      </main>

      {/* ── copy drawer (slide-over) ── */}
      {drawerCard && (
        <CopyDrawer
          card={drawerCard}
          sub={subscriptionByStrategy.get(drawerCard.id) ?? null}
          address={address}
          sponsor={sponsor}
          currentVaultDusdc={currentVaultDusdc}
          walletDusdcNum={walletDusdcNum}
          budget={budget}
          setBudget={setBudget}
          busy={subscribingId === drawerCard.id}
          canceling={!!cancelingId}
          onConfirm={(b) => subscribe(drawerCard, b)}
          onPause={cancelSubscription}
          onShare={() => postToX(buildStrategyShareText(drawerCard))}
          onClose={closeDrawer}
          memoryInfo={memoryInfo}
          onBuyMemory={buyMemoryPass}
          buyingMemory={buyingMemory}
          onReadMemory={readMemoryHandler}
          readingMemory={readingMemory}
          memoryText={memoryText}
        />
      )}
    </div>
  );
}

const INPUT = 'w-full px-3 py-2 rounded bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-[12px] outline-none transition-colors';
const INPUT_NUM = INPUT + ' [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

// ── THE MEMORY MARKET — a gallery of sealed agent minds ───────────────────────
// Each capsule is a redacted playbook that unlocks + reveals when you hold the pass.
// Native to the near-black + vermilion + kanji language; the buy→decrypt reveal is the moment.

function MemoryMarket({ listings, strategies, address, busy, text, onBuy, onRead }: {
  listings: MemoryListingCard[];
  strategies: StrategyCard[];
  address: string | null;
  busy: string | null;
  text: Record<string, string>;
  onBuy: (l: MemoryListingCard) => void;
  onRead: (l: MemoryListingCard) => void;
}) {
  const stratById = useMemo(() => new Map(strategies.map((s) => [s.id, s])), [strategies]);
  return (
    <section className="mt-16 sm:mt-20">
      {/* header — a giant paper kanji watermark behind an editorial headline */}
      <div className="relative">
        <div aria-hidden className="pointer-events-none absolute -top-10 right-0 font-jp font-[800] text-[6.5rem] md:text-[9rem] leading-none text-white/[0.028] select-none tracking-tighter">記憶</div>
        <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-vermilion/80 mb-3">⊙ 記憶市場 · The Memory Market</div>
        <h2 className="font-display font-[800] text-[2rem] md:text-[3.1rem] leading-[0.94] text-white tracking-tight max-w-3xl">
          Own what an agent<br /><span className="text-white/50">has learned.</span>
        </h2>
        <p className="mt-4 text-white/50 text-[15px] leading-relaxed max-w-xl">
          Copy an agent and it trades for you. <span className="text-white/85">Buy its memory</span> and the playbook is yours —
          decrypt it in your own browser, run it, keep it. Every listing is on-chain, vetted, and non-custodial.
        </p>
      </div>

      <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((l, i) => (
          <MemoryCapsule
            key={l.listingId} l={l} strat={stratById.get(l.strategy)} address={address}
            busy={busy} text={text[l.listingId]} onBuy={onBuy} onRead={onRead} idx={i}
          />
        ))}
        <ComingSoonCapsule idx={listings.length} />
      </div>
    </section>
  );
}

function MemoryCapsule({ l, strat, address, busy, text, onBuy, onRead, idx }: {
  l: MemoryListingCard;
  strat: StrategyCard | undefined;
  address: string | null;
  busy: string | null;
  text: string | undefined;
  onBuy: (l: MemoryListingCard) => void;
  onRead: (l: MemoryListingCard) => void;
  idx: number;
}) {
  const glyph = glyphFromAddress(l.strategy);
  const name = codenameFromAddress(l.strategy);
  const buying = busy === `buy:${l.listingId}`;
  const reading = busy === `read:${l.listingId}`;
  const revealed = !!text;
  const settled = strat ? strat.wins + strat.losses : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }}
      transition={{ delay: Math.min(idx, 6) * 0.06, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="group relative flex flex-col border border-white/[0.09] bg-gradient-to-b from-white/[0.035] to-transparent hover:border-white/20 transition-colors overflow-hidden"
    >
      {/* wax-seal — a vermilion hanko in the corner */}
      <div aria-hidden className="absolute top-3 right-3 h-7 w-7 grid place-items-center rounded-full border border-vermilion/50 text-vermilion font-jp text-[11px] shadow-[0_0_18px_-4px_var(--vermilion)]">封</div>

      {/* head: glyph tile + name */}
      <div className="flex items-center gap-3 p-4 pb-3">
        <div className="h-11 w-11 shrink-0 grid place-items-center border border-white/10 bg-white/[0.03] font-jp text-xl text-vermilion">{glyph}</div>
        <div className="min-w-0">
          <div className="font-display font-[800] text-white leading-tight truncate">{name}</div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/35 mt-0.5">agent memory</div>
        </div>
      </div>

      {/* the capsule — sealed (redacted, blurred) or revealed (the real playbook) */}
      <div className="relative mx-4 mb-3 h-[136px] border border-white/[0.07] bg-black/40 overflow-hidden">
        {revealed ? (
          <motion.pre
            initial={{ opacity: 0, filter: 'blur(9px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.75, ease: 'easeOut' }}
            className="h-full overflow-auto p-3 font-mono text-[10.5px] leading-[1.5] text-white/80 whitespace-pre-wrap no-scrollbar"
          >{text}</motion.pre>
        ) : (
          <>
            <div className="p-3.5 space-y-2 blur-[5px] select-none" aria-hidden>
              {[94, 80, 88, 66, 90, 74, 58].map((w, k) => (
                <div key={k} className="h-[7px] rounded-sm bg-white/14" style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className="absolute inset-0 grid place-items-center bg-black/10">
              <div className="flex flex-col items-center gap-1.5">
                <div className="h-8 w-8 grid place-items-center rounded-full border border-vermilion/40 bg-black/50 text-vermilion"><Lock className="h-3.5 w-3.5" /></div>
                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/45">sealed playbook</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* foot: record / owners + price + the CTA */}
      <div className="mt-auto p-4 pt-2.5 border-t border-white/[0.06]">
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
            {settled > 0
              ? <span><span className="text-emerald-400/90">{strat!.wins}W</span> · <span className="text-white/50">{strat!.losses}L</span></span>
              : <span>{l.passesSold} {l.passesSold === 1 ? 'owner' : 'owners'}</span>}
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-display font-[800] text-white text-lg tabular-nums">{l.price}</span>
            <span className="font-mono text-[9.5px] text-white/40">test USDC</span>
          </div>
        </div>

        {!address ? (
          <div className="w-full py-2.5 text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/40 border border-white/10">Connect a wallet to buy</div>
        ) : l.ownsPass ? (
          revealed ? (
            <div className="w-full py-2.5 text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-emerald-400/90 border border-emerald-400/25 bg-emerald-400/[0.04]">✓ Yours · decrypted in your browser</div>
          ) : (
            <button onClick={() => onRead(l)} disabled={reading}
              className="group/cta w-full py-2.5 font-display font-[800] text-sm bg-vermilion text-white hover:bg-vermilion-d transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60">
              {reading ? 'Decrypting…' : <>Decrypt the playbook <ArrowRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-0.5" /></>}
            </button>
          )
        ) : (
          <button onClick={() => onBuy(l)} disabled={buying}
            className="w-full py-2.5 font-display font-[800] text-sm bg-vermilion text-white hover:bg-vermilion-d transition-colors disabled:opacity-60">
            {buying ? 'Buying…' : `Buy the pass · ${l.price} USDC`}
          </button>
        )}
        {address && !l.ownsPass && (
          <div className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-white/25">gas-free · yours to keep, forever</div>
        )}
      </div>
    </motion.div>
  );
}

function ComingSoonCapsule({ idx }: { idx: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }}
      transition={{ delay: Math.min(idx, 6) * 0.06, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex flex-col items-center justify-center gap-3 border border-dashed border-white/[0.09] bg-white/[0.01] p-6 min-h-[280px] text-center"
    >
      <div className="h-10 w-10 grid place-items-center rounded-full border border-white/10 text-white/40"><Sparkles className="h-4 w-4" /></div>
      <div className="font-display font-[800] text-white/70">More minds soon</div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/30 leading-relaxed max-w-[180px]">
        Creators list their own agent&apos;s memory — self-serve, next
      </p>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

// One numbered step of the creator studio — editorial index + rule.
function StudioStep({ n, title, hint, children }: { n: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="font-mono text-[11px] text-vermilion tabular-nums">{n}</span>
        <h3 className="font-display font-[700] text-[15px] text-white">{title}</h3>
        {hint ? <span className="font-mono text-[10px] text-white/30 hidden sm:block">— {hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

// A selectable hosting card (attested vs self-host).
function HostingOption({ active, onClick, badge, title, body }: { active: boolean; onClick: () => void; badge: string; title: string; body: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`group relative text-left rounded-xl border p-4 transition-colors ${active ? 'border-vermilion bg-vermilion/[0.06]' : 'border-white/[0.08] hover:border-white/20'}`}>
      <Crosshairs />
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="font-display font-[700] text-[14px] text-white">{title}</span>
        <span className={`font-mono text-[9px] uppercase tracking-[0.14em] ${active ? 'text-vermilion' : 'text-white/30'}`}>{badge}</span>
      </div>
      <p className="text-[12px] text-gray-400 leading-snug">{body}</p>
    </button>
  );
}

function CapStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-500 block mb-1">{label}</span>
      <span className="font-mono text-sm text-white tabular-nums">
        {value}{unit && <span className="text-gray-500 text-[11px] ml-1">{unit}</span>}
      </span>
    </div>
  );
}

// Crosshair registration ticks — four L-corners that ignite vermilion on card/panel hover.
function Crosshairs() {
  const t = 'pointer-events-none absolute w-2 h-2 opacity-0 transition-all duration-200 group-hover:opacity-100';
  return (
    <>
      <span className={`${t} left-1.5 top-1.5 border-l border-t border-vermilion`} />
      <span className={`${t} right-1.5 top-1.5 border-r border-t border-vermilion`} />
      <span className={`${t} left-1.5 bottom-1.5 border-l border-b border-vermilion`} />
      <span className={`${t} right-1.5 bottom-1.5 border-r border-b border-vermilion`} />
    </>
  );
}

// Tier as an editorial dateline word — never a colored pill. Color never encodes win/loss.
function TierWord({ tier }: { tier: Tier }) {
  if (tier.key === 'settled') return <span className="text-white"><span className="text-vermilion">⊙</span> Settled</span>;
  if (tier.key === 'active') return <span className="text-white/70"><span className="text-vermilion">●</span> Active</span>;
  return <span className="text-white/40">New</span>;
}

// One ruled cell of the card's stat table.
function LedgerStat({ label, value, divide }: { label: string; value: string; divide?: boolean }) {
  return (
    <div className={`px-3 py-3 ${divide ? 'border-l border-white/[0.06]' : ''}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1">{label}</div>
      <div className="font-mono text-sm text-white tabular-nums">{value}</div>
    </div>
  );
}

// ── Copy drawer: the focused subscribe flow (review → size → worked example → confirm) ──
function CopyDrawer(props: {
  card: StrategyCard;
  sub: StrategySubscription | null;
  address: string | null;
  sponsor: SponsorStatus | null;
  currentVaultDusdc: number;
  walletDusdcNum: number;
  budget: string;
  setBudget: (s: string) => void;
  busy: boolean;
  canceling: boolean;
  onConfirm: (budget: string) => void;
  onPause: (sub: StrategySubscription) => void;
  onShare: () => void;
  onClose: () => void;
  memoryInfo: MemoryMarketInfo | null;
  onBuyMemory: () => void;
  buyingMemory: boolean;
  onReadMemory: () => void;
  readingMemory: boolean;
  memoryText: string | null;
}) {
  const { card, sub, address, sponsor, currentVaultDusdc, walletDusdcNum, budget, setBudget, busy, canceling, onConfirm, onPause, onShare, onClose, memoryInfo, onBuyMemory, buyingMemory, onReadMemory, readingMemory, memoryText } = props;
  const tier = tierOf(card);
  const maxTarget = currentVaultDusdc + Math.max(0, walletDusdcNum - card.subFee);
  const target = Number(budget.replace(',', '.'));
  const valid = Number.isFinite(target) && target > 0;
  const topUp = valid ? Math.max(0, target - currentVaultDusdc) : 0;
  const walletNeed = topUp + card.subFee;
  const cap = valid ? Math.min(target, card.maxMargin) : 0;
  const free = card.subFee === 0 && !!sponsor;
  const add = (n: number) => setBudget(String(Math.max(0, (parseFloat(budget || '0') || 0) + n)));
  const agentName = codenameFromAddress(card.id);

  const cta = topUp > 0.000001
    ? `Add ${fmtDusdc(topUp)} test USDC & start copying`
    : `Start copying with current Copy Balance${free ? ' · gas-free' : ''}`;

  return (
    <div className="fixed inset-0 z-[9999] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative h-full w-full max-w-[440px] overflow-y-auto border-l border-white/10 bg-[#0b0b0e] p-6 shadow-2xl animate-[slideIn_.22s_ease]"
        role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full p-2 text-gray-600 hover:bg-white/[0.05] hover:text-white transition-colors">
          <X className="h-4 w-4" />
        </button>

        {/* identity */}
        <div className="flex items-center gap-3 mb-5 pr-8">
          <AgentPortrait seed={card.id} name={agentName} size="drawer" />
          <div className="min-w-0">
            <h2 className="font-display font-[800] text-xl text-white truncate">{agentName}</h2>
            <a href={SUISCAN_ACC(card.agent)} target="_blank" rel="noreferrer" className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500 hover:text-gray-300">On-chain record ↗</a>
          </div>
          <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.2em]"><TierWord tier={tier} /></span>
        </div>

        {/* the guarantee */}
        <div className="border-l-2 border-vermilion pl-4 mb-5">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-vermilion mb-1.5 block">It can&apos;t touch your funds</span>
          <p className="text-[12.5px] text-white/70 leading-snug">
            Your balance stays in your vault. The agent can open positions for you under hard caps, but it
            <span className="text-white font-semibold"> cannot withdraw or divert it.</span>
          </p>
          <a href={SUISCAN_OBJ(card.id)} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-[10px] text-white/40 hover:text-white transition-colors">verify limits on Sui ↗</a>
        </div>

        {/* how it trades — honest mechanism */}
        <div className="border-l-2 border-white/15 pl-4 mb-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 mb-1">How it trades</p>
          <p className="text-[12.5px] text-white/70 leading-snug">
            Each time this agent trades — a Bitcoin up/down call on its momentum read — it opens a position <span className="text-white font-semibold">you own</span>, capped at {fmtDusdc(card.maxMargin)} test USDC and {card.maxLeverage}× per trade. It pays out to you on exit. It&apos;s a directional bet — it can win or lose.
          </p>
        </div>

        {/* caps + record */}
        <div className="grid grid-cols-3 gap-3 mb-2">
          <CapStat label="Most leverage" value={`${card.maxLeverage}×`} unit="" />
          <CapStat label="Most / trade" value={fmtDusdc(card.maxMargin)} unit="test USDC" />
          <CapStat label="Fee" value={card.subFee === 0 ? 'Free' : fmtDusdc(card.subFee)} unit={card.subFee === 0 ? '' : 'test USDC'} />
        </div>
        <div className="grid grid-cols-3 gap-3 pb-4 mb-4 border-b border-white/[0.06]">
          <CapStat label="Copiers" value={card.subscribers > 0 ? String(card.subscribers) : '—'} unit="" />
          <CapStat label="Copy-trades" value={String(card.copyTrades)} unit="" />
          <CapStat label="Last active" value={ago(card.lastActive) || 'no trades yet'} unit="" />
        </div>
        {(card.hasMemory || card.hasCapsule) && (
          <div className="border border-vermilion/30 px-4 py-3 mb-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-vermilion mb-1.5">◈ Agent memory</p>
            <p className="text-[12px] text-white/70 leading-snug">
              This agent keeps its own trading memory on Walrus — open, verifiable, and (with a pass) readable. It guides the agent&apos;s decisions but can never touch your funds.
            </p>
            <div className="flex flex-wrap gap-3 mt-2">
              {card.hasMemory && (
                <a href={SUISCAN_ACC(card.memoryAccount)} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-white/40 hover:text-white transition-colors">verify memory ↗</a>
              )}
              {card.hasCapsule && <span className="font-mono text-[10px] text-white/40">▤ Walrus playbook</span>}
            </div>
          </div>
        )}
        {memoryInfo && (
          <div className="border border-vermilion/25 bg-vermilion/[0.05] rounded-lg px-4 py-3 mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-vermilion">◇ Memory market</span>
              <span className="font-mono text-[10px] text-gray-500">{memoryInfo.passesSold} sold</span>
            </div>
            {memoryInfo.ownsPass ? (
              <div>
                <p className="text-[12px] text-vermilion leading-snug mb-2">● Pass held — your on-chain access right to this agent&apos;s memory.</p>
                {memoryInfo.hasCapsule && !memoryText && (
                  <button
                    onClick={onReadMemory}
                    disabled={readingMemory}
                    className="w-full py-2 text-[12px] font-semibold border border-vermilion/40 text-vermilion hover:bg-vermilion/[0.08] transition-colors disabled:opacity-60"
                  >
                    {readingMemory ? 'Decrypting…' : 'Read the playbook →'}
                  </button>
                )}
                {memoryText && (
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-gray-300 border border-white/10 rounded p-3 bg-black/30">{memoryText}</pre>
                )}
              </div>
            ) : !address ? (
              <>
                <p className="text-[12px] text-gray-300 leading-snug mb-2">Own this agent&apos;s memory as a tradable on-chain asset — {fmtDusdc(memoryInfo.price)} test USDC.</p>
                <ConnectButton />
              </>
            ) : (
              <>
                <p className="text-[12px] text-gray-300 leading-snug mb-2.5">
                  Own this agent&apos;s memory as a tradable on-chain asset. The creator earns; the pass is yours to keep or transfer.
                </p>
                <button
                  onClick={onBuyMemory}
                  disabled={buyingMemory}
                  className="w-full rounded-full py-2.5 text-[13px] font-semibold bg-vermilion text-white hover:bg-vermilion-d transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {buyingMemory ? 'Buying…' : `Buy Memory Pass · ${fmtDusdc(memoryInfo.price)} test USDC`}
                </button>
              </>
            )}
          </div>
        )}
        {tier.key === 'new' && (
          <p className="font-mono text-[11px] text-gray-500 mb-4">Young strategy — short track record. Size accordingly.</p>
        )}

        {sub ? (
          /* manage / exit */
          <div>
            <div className="border-l-2 border-vermilion pl-4 mb-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion mb-1"><span className="inline-block w-1.5 h-1.5 rounded-full bg-vermilion mr-1.5 align-middle" />Copying</p>
              <p className="text-[12.5px] text-white/70 leading-relaxed">
                This agent&apos;s signals are copied into your vault — up to {fmtDusdc(sub.maxMargin)} test USDC each, at most {sub.maxLeverageBps / 10_000}×, every position yours.
              </p>
            </div>
            <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
              Pause stops new copies. Your open positions keep running and stay yours — the agent
              can&apos;t claim their proceeds out from under you.
            </p>
            <button
              onClick={() => onPause(sub)} disabled={canceling}
              className="w-full py-3 rounded-full text-sm font-semibold border border-white/12 text-gray-200 hover:text-white hover:border-white/30 transition-colors disabled:opacity-50"
            >
              {canceling ? 'pausing…' : 'Pause copying'}
            </button>
          </div>
        ) : !address ? (
          <div className="pt-1"><ConnectButton /></div>
        ) : (
          /* size + confirm */
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Copy Balance</span>
              <span className="font-mono text-[10px] text-gray-600">in vault: {fmtDusdc(currentVaultDusdc)} test USDC</span>
            </div>
            <p className="font-mono text-[10px] text-gray-600 leading-relaxed mb-2">
              Add funds to your shared Copy Balance. Your current balance remains at risk across copied agents until you withdraw or pause them.
            </p>
            <div className="rounded-xl border border-white/[0.08] bg-black/30 px-4 py-2.5 transition-colors focus-within:border-vermilion/50">
              <div className="flex items-center justify-between">
                <input
                  autoFocus inputMode="decimal" placeholder="0.00"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="w-full bg-transparent font-display text-2xl font-bold text-white outline-none focus:outline-none focus-visible:outline-none placeholder:text-gray-600"
                />
                <span className="font-mono text-xs font-semibold text-gray-300 shrink-0">test USDC</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-mono text-[10px] text-gray-500">Your limit. Edit anytime. Pause anytime.</span>
                <div className="flex gap-1.5">
                  {[1, 5, 25].map((n) => (
                    <button key={n} onClick={() => add(n)} className="rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors">+{n}</button>
                  ))}
                  <button onClick={() => setBudget(maxTarget.toFixed(2))} className="rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors">max</button>
                </div>
              </div>
            </div>

            {/* live worked example */}
            <p className="mt-3 text-[12px] text-gray-400 leading-relaxed">
              {valid ? (
                <>You set a <span className="text-white font-semibold">{fmtDusdc(target)} test USDC</span> copy balance (shared across the agents you copy). This agent can put at most <span className="text-white font-semibold">{fmtDusdc(cap)} test USDC</span> on each copied trade, up to {card.maxLeverage}×. It can never exceed this — or withdraw your balance.</>
              ) : (
                <>Set a copy balance (shared across the agents you copy). This agent puts at most {fmtDusdc(card.maxMargin)} test USDC on each trade, up to {card.maxLeverage}× — never more, and can never withdraw it.</>
              )}
            </p>

            {valid && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                <CapStat label="Add now" value={fmtDusdc(topUp)} unit="test USDC" />
                <CapStat label="Wallet needed" value={fmtDusdc(walletNeed)} unit="test USDC" />
              </div>
            )}

            {/* risk line */}
            <p className="mt-4 text-[11px] text-gray-500 leading-relaxed">
              Copied trades can lose money. Only fund what you can afford to lose.
            </p>

            <button
              onClick={() => onConfirm(budget)} disabled={busy || !valid}
              className={`mt-3 w-full rounded-full py-3 font-semibold transition-all ${
                busy || !valid ? 'cursor-not-allowed bg-white/[0.07] text-gray-400' : 'bg-vermilion text-white hover:bg-vermilion-d shadow-[0_6px_28px_-8px_var(--vermilion)]'
              }`}
            >
              {busy ? 'Starting…' : !valid ? 'Enter an amount' : cta}
            </button>
          </div>
        )}

        {/* share — moved off the card face */}
        <button onClick={onShare} className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-600 hover:text-vermilion transition-colors">
          <Share2 className="w-3.5 h-3.5" /> Share this agent
        </button>
      </div>
    </div>
  );
}

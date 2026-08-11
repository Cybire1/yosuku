'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { createPublicClient, createWalletClient, custom, http, formatUnits, parseUnits } from 'viem';
import {
  SOURCE_CHAINS, SUI_DOMAIN, ERC20_ABI, TOKEN_MESSENGER_ABI, suiAddressToBytes32,
  humanWait, notifyKeeper, pollDeposit, cctpConfigured, type SourceChain, type DepositStatus,
} from '@/lib/cctp';

// Bring USDC from another chain into your Yosuku balance.
//
// The money is burned on the source chain and minted natively on Sui at YOUR address. Not wrapped,
// not pooled, not held by us: the recipient is signed into Circle's own message, so we could not
// redirect it if we wanted to. We only pay the gas to finish the delivery, which is the one part
// that would otherwise force a brand new user to already own SUI.
//
// Two deliberate product decisions live in this file:
//
//  1. Fast chains are listed first and the wait is stated BEFORE the user commits, not after.
//     Yosuku's markets run 1m/5m/1h. Depositing from Base takes about 19 minutes because OP-stack
//     chains inherit Ethereum finality, by which time the market someone was looking at has
//     settled. From Avalanche it is about 8 seconds. That is not a footnote, it decides whether
//     the deposit is part of the bet or a separate errand, so it is on the button.
//
//  2. Nothing blocks. Once the burn is broadcast the deposit is a background job. The user can
//     close this card and keep browsing; the status survives a refresh because it is keyed off the
//     transaction hash, which we persist.
//
// The card hides itself unless the keeper is actually reachable, because a burn with nothing
// behind it strands the user's USDC until someone relays it by hand.

const LS_KEY = 'yosuku.cctp.pending';
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const injected = (): Eip1193 | null =>
  typeof window !== 'undefined' && (window as unknown as { ethereum?: Eip1193 }).ethereum
    ? (window as unknown as { ethereum: Eip1193 }).ethereum
    : null;

export default function CrossChainDeposit() {
  const account = useCurrentAccount();
  const suiAddress = account?.address ?? null;

  const [chain, setChain] = useState<SourceChain>(SOURCE_CHAINS[0]);
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [amount, setAmount] = useState('5');
  const [busy, setBusy] = useState<'' | 'connect' | 'approve' | 'burn'>('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<{ domain: number; txHash: string; at: number } | null>(null);
  const [status, setStatus] = useState<DepositStatus>({ status: 'unknown' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => { void cctpConfigured().then(setConfigured); }, []);

  const reader = useCallback(
    (c: SourceChain) => createPublicClient({ transport: http(c.rpc) }),
    [],
  );

  // Restore an in-flight deposit. A 19-minute wait WILL outlive the page, so losing this on
  // refresh would leave someone convinced their money vanished.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (raw) setPending(JSON.parse(raw));
    } catch { /* nothing in flight */ }
  }, []);

  const refreshBalance = useCallback(async (c: SourceChain, who: string) => {
    try {
      const bal = await reader(c).readContract({
        address: c.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [who as `0x${string}`],
      });
      setBalance(bal as bigint);
    } catch { setBalance(null); }
  }, [reader]);

  useEffect(() => { if (evmAddress) void refreshBalance(chain, evmAddress); }, [chain, evmAddress, refreshBalance]);

  const connect = useCallback(async () => {
    const eth = injected();
    if (!eth) { setErr('No browser wallet found. Install MetaMask or another EVM wallet to deposit from a different chain.'); return; }
    setErr(''); setBusy('connect');
    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      if (accounts?.[0]) setEvmAddress(accounts[0]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not connect.');
    } finally { setBusy(''); }
  }, []);

  /** Ask the wallet to move to the source chain, adding it if the wallet has never seen it.
   *  Skipping this produces a burn broadcast to whatever chain happened to be selected, which
   *  either reverts or, worse, succeeds against a different deployment. */
  const ensureChain = useCallback(async (eth: Eip1193, c: SourceChain) => {
    const want = `0x${c.chainId.toString(16)}`;
    const current = (await eth.request({ method: 'eth_chainId' })) as string;
    if (current?.toLowerCase() === want) return;
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
    } catch (e) {
      const code = (e as { code?: number })?.code;
      if (code !== 4902) throw e; // 4902 = wallet does not know this chain yet
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: want,
          chainName: c.name,
          rpcUrls: [c.rpc],
          nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 },
          blockExplorerUrls: [c.explorer.replace(/\/tx\/$/, '')],
        }],
      });
    }
  }, []);

  const deposit = useCallback(async () => {
    if (!suiAddress) { setErr('Connect your Sui wallet first, so we know where to deliver.'); return; }
    const eth = injected();
    if (!eth || !evmAddress) { setErr('Connect a wallet on the source chain first.'); return; }

    setErr('');
    try {
      const micro = parseUnits(amount || '0', 6);
      if (micro <= 0n) throw new Error('Enter an amount to deposit.');
      if (balance != null && micro > balance) {
        throw new Error(`You only have ${formatUnits(balance, 6)} USDC on ${chain.name}.`);
      }
      // Fail before spending gas on approve, not after: an unusable recipient means the burn
      // succeeds and the money is unrecoverable.
      const recipient = suiAddressToBytes32(suiAddress);

      await ensureChain(eth, chain);
      const wallet = createWalletClient({ transport: custom(eth) });
      const pub = reader(chain);
      const from = evmAddress as `0x${string}`;

      const allowance = (await pub.readContract({
        address: chain.usdc, abi: ERC20_ABI, functionName: 'allowance', args: [from, chain.tokenMessenger],
      })) as bigint;

      // Approve exactly what is being deposited. An infinite approval would be one less click and
      // a standing claim on the user's USDC by a contract they did not choose. Not our call to make.
      if (allowance < micro) {
        setBusy('approve');
        const hash = await wallet.writeContract({
          account: from, chain: null, address: chain.usdc, abi: ERC20_ABI,
          functionName: 'approve', args: [chain.tokenMessenger, micro],
        });
        await pub.waitForTransactionReceipt({ hash });
      }

      setBusy('burn');
      const burnHash = await wallet.writeContract({
        account: from, chain: null, address: chain.tokenMessenger, abi: TOKEN_MESSENGER_ABI,
        functionName: 'depositForBurn', args: [micro, SUI_DOMAIN, recipient, chain.usdc],
      });

      const rec = { domain: chain.domain, txHash: burnHash, at: Date.now() };
      setPending(rec);
      window.localStorage.setItem(LS_KEY, JSON.stringify(rec));
      setStatus({ status: 'pending', enqueuedAt: Date.now(), etaSeconds: chain.seconds });
      await notifyKeeper(chain.domain, burnHash, suiAddress);
      void refreshBalance(chain, from);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/User rejected|denied/i.test(m) ? 'Cancelled.' : m.slice(0, 220));
    } finally { setBusy(''); }
  }, [suiAddress, evmAddress, amount, balance, chain, ensureChain, reader, refreshBalance]);

  // Poll while something is in flight. Cleared on delivery so we stop hitting the keeper forever.
  useEffect(() => {
    if (!pending) return;
    const tick = async () => {
      const s = await pollDeposit(pending.domain, pending.txHash);
      setStatus(s);
      if (s.status === 'delivered') {
        window.localStorage.removeItem(LS_KEY);
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };
    void tick();
    pollRef.current = setInterval(tick, 6000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pending]);

  if (configured === false) return null;

  const pendingChain = pending ? SOURCE_CHAINS.find((c) => c.domain === pending.domain) : null;

  return (
    <div className="border border-white/[0.07] rounded-2xl p-5 bg-[#0d0d10]">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="font-display text-lg font-bold">Deposit from another chain</h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500">USDC</span>
      </div>
      <p className="font-mono text-[11px] text-gray-500 mb-4 leading-relaxed">
        Your USDC is burned on the chain it sits on and minted on Sui at your own address. We pay the
        Sui gas so you do not need any. Only you can spend it when it lands.
      </p>

      {/* Chain choice carries the wait time, because that is the thing that actually differs. */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {SOURCE_CHAINS.map((c) => (
          <button
            key={c.domain}
            onClick={() => setChain(c)}
            className={`rounded-xl border px-3 py-2 text-left transition ${
              chain.domain === c.domain ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-white/[0.07] hover:border-white/20'
            }`}
          >
            <div className="font-mono text-[11px] font-semibold">{c.name}</div>
            <div className={`font-mono text-[10px] ${c.seconds <= 30 ? 'text-emerald-400' : 'text-gray-500'}`}>
              {humanWait(c.seconds)}
            </div>
          </button>
        ))}
      </div>

      {/* NOT bg-white: the light theme remaps .bg-white to #141210, so a white button with dark
          text renders dark-on-dark and the label vanishes. Vermilion is the app's primary fill and
          globals.css explicitly pins its label light in BOTH themes, which is the guarantee needed
          here. Same trap one button down, where .text-black would flip to cream on the green. */}
      {!evmAddress ? (
        <button
          onClick={connect}
          disabled={busy === 'connect'}
          className="w-full rounded-xl bg-[#E04D26] text-white font-bold py-2.5 text-sm transition-colors hover:bg-[#B83A1B] disabled:opacity-50"
        >
          {busy === 'connect' ? 'Connecting…' : `Connect a wallet on ${chain.name}`}
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2 font-mono text-[11px] text-gray-500">
            <span>{short(evmAddress)}</span>
            <span>{balance == null ? '—' : `${formatUnits(balance, 6)} USDC`}</span>
          </div>
          <div className="flex gap-2 mb-3">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              className="flex-1 rounded-xl bg-white/[0.04] border border-white/[0.07] px-3 py-2 font-mono text-sm outline-none focus:border-white/25"
              placeholder="Amount"
            />
            {balance != null && balance > 0n && (
              <button
                onClick={() => setAmount(formatUnits(balance, 6))}
                className="rounded-xl border border-white/[0.07] px-3 font-mono text-[11px] text-gray-400 hover:border-white/20"
              >
                Max
              </button>
            )}
          </div>
          <button
            onClick={deposit}
            disabled={!!busy || !suiAddress}
            className="w-full rounded-xl bg-emerald-500 text-[#0d0d10] font-bold py-2.5 text-sm transition-colors hover:bg-emerald-400 disabled:opacity-50"
          >
            {busy === 'approve' ? 'Approving…' : busy === 'burn' ? 'Confirm in your wallet…'
              : `Deposit from ${chain.name} · ${humanWait(chain.seconds)}`}
          </button>
          {!suiAddress && (
            <p className="font-mono text-[10px] text-amber-400/80 mt-2">
              Connect your Sui wallet so we know where to deliver.
            </p>
          )}
        </>
      )}

      {err && <p className="font-mono text-[11px] text-red-400 mt-3 leading-relaxed">{err}</p>}

      {pending && status.status !== 'delivered' && (
        <div className="mt-4 rounded-xl border border-white/[0.07] p-3">
          <div className="font-mono text-[11px] font-semibold mb-1">
            {status.status === 'failed' ? 'Deposit needs attention' : 'On its way'}
          </div>
          <p className="font-mono text-[10px] text-gray-500 leading-relaxed">
            {status.status === 'failed'
              ? (status as { dead: string }).dead
              : `Waiting for ${pendingChain?.name ?? 'the source chain'} to finalise, ${humanWait(pendingChain?.seconds ?? 60)}. You can leave this page, it keeps going.`}
          </p>
          {pendingChain && (
            <a href={`${pendingChain.explorer}${pending.txHash}`} target="_blank" rel="noreferrer"
               className="font-mono text-[10px] text-gray-400 hover:text-white inline-flex items-center gap-1 mt-2">
              View burn <ArrowUpRight size={11} />
            </a>
          )}
        </div>
      )}

      {status.status === 'delivered' && (
        <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3">
          <div className="font-mono text-[11px] text-emerald-300">Landed on Sui</div>
          <p className="font-mono text-[10px] text-gray-400 mt-1">
            {(status as { amountMicro?: string }).amountMicro
              ? `${formatUnits(BigInt((status as { amountMicro: string }).amountMicro), 6)} USDC is in your wallet.`
              : 'Your USDC is in your wallet.'}
          </p>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import ChainIcon from '@/components/ChainIcon';
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

// Phantom and friends expose the same shape. Using the injected provider directly rather than
// pulling in the wallet-adapter React tree, which would mean another context provider wrapping the
// whole app for one card.
type SolProvider = {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string }>;
  signTransaction?: (tx: unknown) => Promise<unknown>;
};
const solProvider = (): SolProvider | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { solana?: SolProvider; phantom?: { solana?: SolProvider } };
  return w.phantom?.solana ?? w.solana ?? null;
};

export default function CrossChainDeposit({
  triggerClassName,
  triggerLabel,
}: {
  /** Lets a host restyle the trigger (e.g. a full-width row inside the Add money modal) without
   *  duplicating the sheet, so there is one deposit flow rather than two that can drift. */
  triggerClassName?: string;
  triggerLabel?: string;
} = {}) {
  const account = useCurrentAccount();
  const suiAddress = account?.address ?? null;

  const [chain, setChain] = useState<SourceChain>(SOURCE_CHAINS[0]);
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [solAddress, setSolAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [amount, setAmount] = useState('5');
  const [busy, setBusy] = useState<'' | 'connect' | 'approve' | 'burn'>('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<{ domain: number; txHash: string; at: number } | null>(null);
  const [status, setStatus] = useState<DepositStatus>({ status: 'unknown' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

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
      if (c.kind === 'solana') {
        const { Connection, PublicKey } = await import('@solana/web3.js');
        const { SOL, associatedTokenAddress } = await import('@/lib/cctpSolana');
        const ata = associatedTokenAddress(new PublicKey(who), SOL.usdcDevnet);
        const conn = new Connection(SOL.rpc, 'confirmed');
        const bal = await conn.getTokenAccountBalance(ata).catch(() => null);
        setBalance(bal ? BigInt(bal.value.amount) : 0n);
        return;
      }
      const bal = await reader(c).readContract({
        address: c.usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [who as `0x${string}`],
      });
      setBalance(bal as bigint);
    } catch { setBalance(null); }
  }, [reader]);

  const connected = chain.kind === 'solana' ? solAddress : evmAddress;

  useEffect(() => {
    if (connected) void refreshBalance(chain, connected);
    else setBalance(null);
  }, [chain, connected, refreshBalance]);

  const connect = useCallback(async () => {
    setErr(''); setBusy('connect');
    try {
      if (chain.kind === 'solana') {
        const sol = solProvider();
        if (!sol) throw new Error('No Solana wallet found. Install Phantom to deposit from Solana.');
        const res = await sol.connect();
        setSolAddress(res.publicKey.toBase58());
        return;
      }
      const eth = injected();
      if (!eth) throw new Error('No browser wallet found. Install MetaMask or another EVM wallet to deposit from that chain.');
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      if (accounts?.[0]) setEvmAddress(accounts[0]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not connect.');
    } finally { setBusy(''); }
  }, [chain]);

  /** Solana burn. Two things differ from EVM and both are easy to get wrong:
   *  no approve step (the program burns from the user's token account directly under its own
   *  authority PDA), and the MessageSent event account is a fresh keypair that must co-sign. That
   *  keypair is throwaway: it exists only so Circle can store the outgoing message for the
   *  attestation service to read back. */
  const depositFromSolana = useCallback(async (microAmount: bigint) => {
    const sol = solProvider();
    if (!sol || !solAddress || !suiAddress) throw new Error('Connect both wallets first.');
    const { Connection, PublicKey, Transaction, Keypair } = await import('@solana/web3.js');
    const { SOL, buildDepositForBurnIx, associatedTokenAddress, suiAddressToSolanaPubkey } = await import('@/lib/cctpSolana');

    const owner = new PublicKey(solAddress);
    const conn = new Connection(SOL.rpc, 'confirmed');
    const eventAccount = Keypair.generate();

    const tx = new Transaction().add(buildDepositForBurnIx({
      owner,
      burnTokenAccount: associatedTokenAddress(owner, SOL.usdcDevnet),
      mint: SOL.usdcDevnet,
      messageSentEventData: eventAccount.publicKey,
      amount: microAmount,
      destinationDomain: SUI_DOMAIN,
      mintRecipient: suiAddressToSolanaPubkey(suiAddress),
    }));
    tx.feePayer = owner;
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    // The throwaway keypair signs locally; the wallet adds the user's signature after.
    tx.partialSign(eventAccount);

    if (!sol.signTransaction) throw new Error('This Solana wallet cannot sign transactions.');
    const signed = await sol.signTransaction(tx);
    const raw = (signed as { serialize(): Uint8Array }).serialize();
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
    return sig;
  }, [solAddress, suiAddress]);

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
    if (!connected) { setErr('Connect a wallet on the source chain first.'); return; }

    setErr('');
    try {
      const micro = parseUnits(amount || '0', 6);
      if (micro <= 0n) throw new Error('Enter an amount to deposit.');
      if (balance != null && micro > balance) {
        throw new Error(`You only have ${formatUnits(balance, 6)} USDC on ${chain.name}.`);
      }

      if (chain.kind === 'solana') {
        setBusy('burn');
        const sig = await depositFromSolana(micro);
        const rec = { domain: chain.domain, txHash: sig, at: Date.now() };
        setPending(rec);
        window.localStorage.setItem(LS_KEY, JSON.stringify(rec));
        setStatus({ status: 'pending', enqueuedAt: Date.now(), etaSeconds: chain.seconds });
        await notifyKeeper(chain.domain, sig, suiAddress);
        void refreshBalance(chain, connected);
        return;
      }

      const eth = injected();
      if (!eth) throw new Error('No EVM wallet found.');
      // Fail before spending gas on approve, not after: an unusable recipient means the burn
      // succeeds and the money is unrecoverable.
      const recipient = suiAddressToBytes32(suiAddress);

      await ensureChain(eth, chain);
      const wallet = createWalletClient({ transport: custom(eth) });
      const pub = reader(chain);
      const from = connected as `0x${string}`;

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
  }, [suiAddress, connected, amount, balance, chain, ensureChain, reader, refreshBalance, depositFromSolana]);

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

  // Render nothing until we KNOW the rail is up, and never without a Sui address. It mounted
  // during the config check and vanished when it resolved, which is the flicker that read as
  // "shows then disconnects", and it cannot work without a destination: the burn names a mint
  // recipient, so with no Sui wallet there is nowhere to deliver.
  if (configured !== true || !suiAddress) return null;

  const pendingChain = pending ? SOURCE_CHAINS.find((c) => c.domain === pending.domain) : null;
  const inFlight = !!pending && status.status !== 'delivered';

  // One button, and the chains live behind it.
  //
  // This was a full-width card carrying a paragraph of explanation and a wait time under every
  // chain. On the portfolio that is a wall of reading in front of a two-tap job, and the copy
  // answered a question nobody had asked yet. Deposit is a button; picking where the money comes
  // from is a choice you make after deciding to deposit, not before.
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={triggerClassName ?? 'inline-flex items-center gap-2 rounded-xl bg-[#E04D26] px-4 py-2.5 font-display text-sm font-bold text-white transition-colors hover:bg-[#B83A1B]'}
      >
        {triggerLabel ?? 'Deposit'}
        {inFlight && <span className="h-1.5 w-1.5 rounded-full bg-white/90 animate-pulse" />}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="my-auto w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#0d0d10] p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">Deposit USDC</h3>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-gray-500 hover:text-white">
                <X size={18} />
              </button>
            </div>

            {/* Chain names only. The wait differs a lot per chain, but it is not what someone is
                deciding here: they deposit from wherever their USDC already is. */}
            <div className="mb-4 grid grid-cols-2 gap-2">
              {SOURCE_CHAINS.map((c) => (
                <button
                  key={c.domain}
                  onClick={() => setChain(c)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left font-mono text-[12px] font-semibold transition ${
                    chain.domain === c.domain
                      ? 'border-emerald-500/45 bg-emerald-500/[0.07]'
                      : 'border-white/[0.07] hover:border-white/25'
                  }`}
                >
                  <ChainIcon domain={c.domain} />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>

            {!connected ? (
              <button
                onClick={connect}
                disabled={busy === 'connect'}
                className="w-full rounded-xl bg-[#E04D26] py-2.5 font-display text-sm font-bold text-white transition-colors hover:bg-[#B83A1B] disabled:opacity-50"
              >
                {busy === 'connect' ? 'Connecting…' : `Connect ${chain.name}`}
              </button>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-gray-500">
                  <span>{chain.kind === 'solana' ? `${connected.slice(0, 4)}…${connected.slice(-4)}` : short(connected)}</span>
                  <span>{balance == null ? '—' : `${formatUnits(balance, 6)} USDC`}</span>
                </div>
                <div className="mb-3 flex gap-2">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    inputMode="decimal"
                    placeholder="Amount"
                    className="flex-1 rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2 font-mono text-sm outline-none focus:border-white/25"
                  />
                  {balance != null && balance > 0n && (
                    <button
                      onClick={() => setAmount(formatUnits(balance, 6))}
                      className="rounded-xl border border-white/[0.07] px-3 font-mono text-[11px] text-gray-400 hover:border-white/25"
                    >
                      Max
                    </button>
                  )}
                </div>
                <button
                  onClick={deposit}
                  disabled={!!busy}
                  className="w-full rounded-xl bg-emerald-500 py-2.5 font-display text-sm font-bold text-[#0d0d10] transition-colors hover:bg-emerald-400 disabled:opacity-50"
                >
                  {busy === 'approve' ? 'Approving…' : busy === 'burn' ? 'Confirm in your wallet…' : 'Deposit'}
                </button>
              </>
            )}

            {err && <p className="mt-3 font-mono text-[11px] leading-relaxed text-red-400">{err}</p>}

            {inFlight && (
              <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-gray-500">
                <span>{status.status === 'failed' ? 'Needs attention' : 'On its way'}</span>
                {pendingChain && (
                  <a href={`${pendingChain.explorer}${pending!.txHash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white">
                    View <ArrowUpRight size={11} />
                  </a>
                )}
              </div>
            )}

            {status.status === 'delivered' && (
              <p className="mt-3 font-mono text-[11px] text-emerald-400">Landed on Sui.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

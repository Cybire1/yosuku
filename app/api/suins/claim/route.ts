// SuiNS subname mint — issues `<label>.yosuku.sui` as a LEAF subname pointing at the
// caller's address, on MAINNET. The mint IS the reservation (on-chain, globally unique).
//
// The signer key (owner of the `yosuku.sui` registration NFT) lives ONLY here, server-side,
// never in the app — same trust model as the faucet / Onara. Set two env secrets:
//   SUINS_SIGNER_KEY  — `suiprivkey…` of the wallet holding the yosuku.sui registration NFT
//   SUINS_PARENT_NFT  — the object id of that yosuku.sui registration NFT
// The signer wallet also needs a little MAINNET SUI for gas.
//
// NOTE: @mysten/suins@1.2.2 peer-wants @mysten/sui ^2.20 (repo is on 2.17). Bump + smoke-test
// before flipping this live, or run this handler on the box where the sui version is isolated.
import { NextRequest, NextResponse } from 'next/server';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuinsClient, SuinsTransaction } from '@mysten/suins';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PARENT = 'yosuku.sui';
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const ADDR_RE = /^0x[0-9a-f]{64}$/i;

function getSigner(): Ed25519Keypair | null {
  const k = process.env.SUINS_SIGNER_KEY;
  if (!k) return null;
  try {
    return Ed25519Keypair.fromSecretKey(k.trim());
  } catch {
    return null;
  }
}

const isReady = () => !!process.env.SUINS_SIGNER_KEY && !!process.env.SUINS_PARENT_NFT;

// Status — the app gates "claim" on this; flips to ready the moment the secrets are set.
export async function GET() {
  return NextResponse.json({ ready: isReady(), parent: PARENT });
}

export async function POST(req: NextRequest) {
  let body: { address?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  }
  const address = (body.address || '').trim();
  const label = (body.label || '').trim().toLowerCase();

  if (!ADDR_RE.test(address)) return NextResponse.json({ ok: false, error: 'Invalid address' }, { status: 400 });
  if (!LABEL_RE.test(label)) {
    return NextResponse.json({ ok: false, error: 'Invalid name — 3–63 chars, a–z 0–9 and hyphens.' }, { status: 400 });
  }

  const signer = getSigner();
  const parentNft = process.env.SUINS_PARENT_NFT;
  if (!signer || !parentNft) {
    return NextResponse.json({ ok: false, error: 'Name minting is not live yet.' }, { status: 503 });
  }

  const name = `${label}.${PARENT}`;
  const client = new SuiJsonRpcClient({ url: process.env.SUI_MAINNET_RPC || 'https://fullnode.mainnet.sui.io', network: 'mainnet' });

  // Availability — the mint would fail anyway, but a clean 409 is better UX.
  try {
    const existing = await client.resolveNameServiceAddress({ name });
    if (existing) return NextResponse.json({ ok: false, error: 'That name is taken.' }, { status: 409 });
  } catch {
    /* resolve hiccup → proceed; the on-chain mint is the source of truth */
  }

  try {
    const suinsClient = new SuinsClient({ client, network: 'mainnet' });
    const tx = new Transaction();
    const st = new SuinsTransaction(suinsClient, tx);
    // Leaf subname: a record pointing at the user's address, owned/controlled by the parent.
    st.createLeafSubName({ parentNft, name, targetAddress: address });
    tx.setSender(signer.toSuiAddress());

    const res = await client.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true },
    });
    if (res.effects?.status?.status !== 'success') {
      return NextResponse.json({ ok: false, error: res.effects?.status?.error || 'Mint failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, name, digest: res.digest, target: address });
  } catch (e) {
    console.warn('suins mint failed', e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Mint failed' }, { status: 502 });
  }
}

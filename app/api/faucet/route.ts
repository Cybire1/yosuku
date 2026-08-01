// In-app test-USDC faucet. Drips DUSDC to a connected account so a freshly
// onboarded (zkLogin) user can trade without leaving the site. Signs with a
// DEDICATED faucet key (never the deployer key).
//
// Once-per-day gating, no external store required:
//   1. per-device  — a secure httpOnly cookie (stops one device draining via many addresses)
//   2. per-account — on-chain: did the faucet fund this address in the last 24h?
//                    (the chain is the store → survives cookie-clears; for zkLogin
//                     the address == the Google account, so this is per-account)
//   3. balance gate — won't top up an address that already holds more than 3 DUSDC
//
// The open web claim drips 2 DUSDC. The X-Predict auto-onboard relay drips 5, gated
// behind a shared key (ONBOARD_KEY) so only the relay — not the public button — pulls the larger amount.
import { NextRequest, NextResponse } from 'next/server';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { DUSDC_TYPE } from '@/lib/sui/constants';

const DRIP = BigInt(2_000_000);          // 2 DUSDC — the open web claim
const ONBOARD_DRIP = BigInt(5_000_000);  // 5 DUSDC — X-Predict auto-onboard only (key-gated)
const FUND_CAP = BigInt(3_000_000);      // already holds more than 3 DUSDC → don't fund
// shared secret: only the X-Predict relay knows this, so the open button can't pull the 5 DUSDC drip.
const ONBOARD_KEY = process.env.FAUCET_ONBOARD_KEY || 'yx_onbk_9f4c2e7a13b6d805e2a4c1';
const DAY_MS = 24 * 60 * 60 * 1000;
const FAUCET_ADDR = '0x7c89c67ca62eca789d2247d4168edc3dded1d93ec2706119e861f128ef212fab';
const OFFICIAL_FAUCET = 'https://tally.so/r/Xx102L';
const COOKIE = 'yfp_claim';

// The public fullnode's JSON-RPC is sunset (every call 404s → faucet fell back to the tally form).
// publicnode still serves the JSON-RPC surface this route needs (getBalance/getCoins/execute).
const RPC_URL = process.env.SUI_RPC_URL || 'https://sui-testnet-rpc.publicnode.com';
const rpc = () => new SuiJsonRpcClient({ url: RPC_URL, network: 'testnet' });

/** Did the faucet wallet fund `address` with DUSDC in the last 24h? (chain = the store) */
async function fundedRecently(client: SuiJsonRpcClient, address: string): Promise<boolean> {
  try {
    const res = await client.queryTransactionBlocks({
      filter: { FromAddress: FAUCET_ADDR },
      options: { showBalanceChanges: true },
      order: 'descending',
      limit: 25,
    });
    const cutoff = Date.now() - DAY_MS;
    for (const tx of res.data) {
      if (tx.timestampMs && Number(tx.timestampMs) < cutoff) break; // older than 24h → stop
      for (const bc of tx.balanceChanges ?? []) {
        const owner = (bc.owner as { AddressOwner?: string })?.AddressOwner;
        if (owner === address && bc.coinType === DUSDC_TYPE && BigInt(bc.amount) > BigInt(0)) return true;
      }
    }
  } catch { /* fail-open on the on-chain layer; cookie + balance still gate */ }
  return false;
}

export async function POST(req: NextRequest) {
  const key = process.env.FAUCET_PRIVATE_KEY;
  if (!key) return NextResponse.json({ error: 'Faucet not configured.', faucetUrl: OFFICIAL_FAUCET }, { status: 503 });

  let address: string;
  let onboardKey: string | undefined;
  try { ({ address, onboardKey } = await req.json()); }
  catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  if (!/^0x[0-9a-fA-F]{64}$/.test(address ?? '')) {
    return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
  }
  // the X-Predict relay pulls the larger drip; the open web button gets the standard 2 DUSDC.
  const amount = onboardKey && onboardKey === ONBOARD_KEY ? ONBOARD_DRIP : DRIP;

  // 1. per-device cookie gate
  const claimedAt = Number(req.cookies.get(COOKIE)?.value ?? 0);
  if (claimedAt && Date.now() - claimedAt < DAY_MS) {
    const hrs = Math.ceil((DAY_MS - (Date.now() - claimedAt)) / 3_600_000);
    return NextResponse.json({ error: `Already claimed today on this device — try again in ~${hrs}h.`, faucetUrl: OFFICIAL_FAUCET }, { status: 429 });
  }

  const client = rpc();
  try {
    // 3. balance gate — already holding more than 3 DUSDC means they can trade; don't fund
    const have = BigInt((await client.getBalance({ owner: address, coinType: DUSDC_TYPE })).totalBalance);
    if (have > FUND_CAP) {
      return NextResponse.json({ ok: true, alreadyFunded: true, balance: Number(have) / 1e6, message: 'You already have DUSDC — ready to trade.' });
    }
    // 2. per-account on-chain gate
    if (await fundedRecently(client, address)) {
      return NextResponse.json({ error: 'This account was already funded today — come back tomorrow.', faucetUrl: OFFICIAL_FAUCET }, { status: 429 });
    }

    const faucet = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey);

    // Ask what the wallet HOLDS, not what it holds as Coin objects.
    //
    // These stopped being the same thing. Sui now keeps funds in an address balance as well as
    // in Coin objects, and `getCoins` only ever returns the objects. This faucet was funded with
    // 2000 DUSDC that landed in the address balance, so `getCoins` reported 1.19 and every claim
    // was refused as "the faucet is empty" while 2000 DUSDC sat in the wallet untouched. The
    // money was never missing; we were counting it in the one place it was not.
    const held = BigInt((await client.getBalance({ owner: faucet.toSuiAddress(), coinType: DUSDC_TYPE })).totalBalance);
    if (held < amount) {
      return NextResponse.json({ error: 'The instant faucet is empty right now. Grab DUSDC from the DeepBook faucet.', faucetUrl: OFFICIAL_FAUCET }, { status: 503 });
    }

    // coinWithBalance sources the drip from the address balance when there is one and falls back
    // to owned coins otherwise, so it spends the whole holding rather than just the object half.
    const tx = new Transaction();
    tx.transferObjects([coinWithBalance({ type: DUSDC_TYPE, balance: amount })], address);

    const res = await client.signAndExecuteTransaction({ signer: faucet, transaction: tx });
    await client.waitForTransaction({ digest: res.digest });

    const out = NextResponse.json({
      ok: true, amount: Number(amount) / 1e6, digest: res.digest,
      explorer: `https://suiscan.xyz/testnet/tx/${res.digest}`,
    });
    out.cookies.set(COOKIE, String(Date.now()), {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: DAY_MS / 1000,
    });
    return out;
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e), faucetUrl: OFFICIAL_FAUCET }, { status: 500 });
  }
}

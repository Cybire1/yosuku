// In-app test-USDC faucet. Drips DUSDC to a connected account so a freshly
// onboarded (zkLogin) user can trade without leaving the site. Signs with a
// DEDICATED faucet key (never the deployer key).
//
// Once-per-day gating, no external store required:
//   1. per-device  — a secure httpOnly cookie (stops one device draining via many addresses)
//   2. per-account — on-chain: did the faucet fund this address in the last 24h?
//                    (the chain is the store → survives cookie-clears; for zkLogin
//                     the address == the Google account, so this is per-account)
//   3. balance gate — won't top up an address that already holds >= the drip
import { NextRequest, NextResponse } from 'next/server';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { DUSDC_TYPE } from '@/lib/sui/constants';

const DRIP = BigInt(2_000_000);     // 2 DUSDC
const FUNDED_AT = BigInt(2_000_000); // skip if they already hold >= this
const DAY_MS = 24 * 60 * 60 * 1000;
const FAUCET_ADDR = '0x7c89c67ca62eca789d2247d4168edc3dded1d93ec2706119e861f128ef212fab';
const OFFICIAL_FAUCET = 'https://tally.so/r/Xx102L';
const COOKIE = 'yfp_claim';

const rpc = () => new SuiJsonRpcClient({ url: 'https://fullnode.testnet.sui.io:443', network: 'testnet' });

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
  try { ({ address } = await req.json()); }
  catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  if (!/^0x[0-9a-fA-F]{64}$/.test(address ?? '')) {
    return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
  }

  // 1. per-device cookie gate
  const claimedAt = Number(req.cookies.get(COOKIE)?.value ?? 0);
  if (claimedAt && Date.now() - claimedAt < DAY_MS) {
    const hrs = Math.ceil((DAY_MS - (Date.now() - claimedAt)) / 3_600_000);
    return NextResponse.json({ error: `Already claimed today on this device — try again in ~${hrs}h.`, faucetUrl: OFFICIAL_FAUCET }, { status: 429 });
  }

  const client = rpc();
  try {
    // 3. balance gate
    const have = BigInt((await client.getBalance({ owner: address, coinType: DUSDC_TYPE })).totalBalance);
    if (have >= FUNDED_AT) {
      return NextResponse.json({ ok: true, alreadyFunded: true, balance: Number(have) / 1e6, message: 'You already have test USDC — ready to trade.' });
    }
    // 2. per-account on-chain gate
    if (await fundedRecently(client, address)) {
      return NextResponse.json({ error: 'This account was already funded today — come back tomorrow.', faucetUrl: OFFICIAL_FAUCET }, { status: 429 });
    }

    const faucet = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey);
    const coins = (await client.getCoins({ owner: faucet.toSuiAddress(), coinType: DUSDC_TYPE })).data;
    const total = coins.reduce((s, c) => s + BigInt(c.balance), BigInt(0));
    if (total < DRIP) {
      return NextResponse.json({ error: 'The instant faucet is empty right now — grab test USDC from the DeepBook faucet.', faucetUrl: OFFICIAL_FAUCET }, { status: 503 });
    }

    const tx = new Transaction();
    const [primary, ...rest] = coins.map((c) => tx.object(c.coinObjectId));
    if (rest.length) tx.mergeCoins(primary, rest);
    const [drip] = tx.splitCoins(primary, [DRIP]);
    tx.transferObjects([drip], address);

    const res = await client.signAndExecuteTransaction({ signer: faucet, transaction: tx });
    await client.waitForTransaction({ digest: res.digest });

    const out = NextResponse.json({
      ok: true, amount: Number(DRIP) / 1e6, digest: res.digest,
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

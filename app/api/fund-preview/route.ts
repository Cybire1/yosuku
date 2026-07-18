// PREVIEW on-ramp drip. After a Paystack TEST-MODE payment succeeds, deliver the
// exact DUSDC amount straight to the user's OWN wallet (self-custodial). This is a
// showcase of the mainnet go-to-market on testnet: no real money moves (Paystack test
// mode), the funds are test DUSDC, and Yosuku never holds them.
//
// Honesty + safety:
//   - amount is capped (a preview, not a spigot)
//   - if PAYSTACK_SECRET_KEY (a TEST secret, sk_test_…) is set, the payment reference
//     is verified server-side against Paystack before crediting; if not, the preview
//     trusts the client callback (test money only)
//   - signs with the same dedicated faucet key as /api/faucet, never the deployer
import { NextRequest, NextResponse } from 'next/server';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { DUSDC_TYPE } from '@/lib/sui/constants';

const MAX_DUSDC = 50;                 // preview ceiling per request
const MUL = 1_000_000;
const RPC_URL = process.env.SUI_RPC_URL || 'https://sui-testnet-rpc.publicnode.com';
const rpc = () => new SuiJsonRpcClient({ url: RPC_URL, network: 'testnet' });

/** Verify a Paystack transaction reference (test mode) when a test secret is configured. */
async function paystackVerified(reference: string): Promise<boolean> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return true; // no secret set → preview trusts the client (test money only)
  if (!reference) return false;
  try {
    const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    const j = await r.json();
    return !!(r.ok && j?.status && j?.data?.status === 'success');
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const key = process.env.FAUCET_PRIVATE_KEY;
  if (!key) return NextResponse.json({ error: 'Preview faucet not configured.' }, { status: 503 });

  let address: string, amountDusdc: number, reference: string | undefined;
  try {
    const body = await req.json();
    address = body.address;
    amountDusdc = Number(body.amountDusdc);
    reference = typeof body.reference === 'string' ? body.reference : undefined;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(address ?? '')) {
    return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
  }
  if (!Number.isFinite(amountDusdc) || amountDusdc <= 0) {
    return NextResponse.json({ error: 'Enter an amount.' }, { status: 400 });
  }
  const amount = Math.min(amountDusdc, MAX_DUSDC);
  const drip = BigInt(Math.floor(amount * MUL));

  if (!(await paystackVerified(reference ?? ''))) {
    return NextResponse.json({ error: 'Payment could not be verified.' }, { status: 402 });
  }

  const client = rpc();
  try {
    const faucet = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey);
    const coins = (await client.getCoins({ owner: faucet.toSuiAddress(), coinType: DUSDC_TYPE })).data;
    const total = coins.reduce((s, c) => s + BigInt(c.balance), BigInt(0));
    if (total < drip) {
      return NextResponse.json({ error: 'Preview reserve is low right now. Try a smaller amount.' }, { status: 503 });
    }

    const tx = new Transaction();
    const [primary, ...rest] = coins.map((c) => tx.object(c.coinObjectId));
    if (rest.length) tx.mergeCoins(primary, rest);
    const [out] = tx.splitCoins(primary, [drip]);
    tx.transferObjects([out], address); // straight to the user's own wallet

    const res = await client.signAndExecuteTransaction({ signer: faucet, transaction: tx });
    await client.waitForTransaction({ digest: res.digest });

    return NextResponse.json({
      ok: true,
      amount,
      digest: res.digest,
      explorer: `https://suiscan.xyz/testnet/tx/${res.digest}`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

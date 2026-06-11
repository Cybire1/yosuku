// In-app test-USDC faucet. Drips a small amount of DUSDC to a connected
// account so a freshly-onboarded (zkLogin) user can trade without leaving the
// site. Signs with a DEDICATED faucet key (never the deployer key). Balance-
// gated rather than stateful: it won't top up an address that's already funded,
// which is drain-safe even across serverless instances.
import { NextRequest, NextResponse } from 'next/server';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { DUSDC_TYPE } from '@/lib/sui/constants';

const DRIP = BigInt(500_000);        // 0.5 DUSDC — enough for a real bet
const FUNDED_AT = BigInt(500_000);   // don't drip if they already hold >= this
const OFFICIAL_FAUCET = 'https://tally.so/r/Xx102L';

export async function POST(req: NextRequest) {
  const key = process.env.FAUCET_PRIVATE_KEY;
  if (!key) {
    return NextResponse.json({ error: 'Faucet not configured.', faucetUrl: OFFICIAL_FAUCET }, { status: 503 });
  }
  let address: string;
  try {
    ({ address } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(address ?? '')) {
    return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
  }

  const client = new SuiJsonRpcClient({ url: 'https://fullnode.testnet.sui.io:443', network: 'testnet' });

  try {
    // already funded? (drain-safe, no server state needed)
    const have = BigInt((await client.getBalance({ owner: address, coinType: DUSDC_TYPE })).totalBalance);
    if (have >= FUNDED_AT) {
      return NextResponse.json({
        ok: true, alreadyFunded: true,
        balance: Number(have) / 1e6,
        message: 'You already have test USDC — ready to trade.',
      });
    }

    const faucet = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey);
    const coins = (await client.getCoins({ owner: faucet.toSuiAddress(), coinType: DUSDC_TYPE })).data;
    const total = coins.reduce((s, c) => s + BigInt(c.balance), BigInt(0));
    if (total < DRIP) {
      return NextResponse.json(
        { error: 'The instant faucet is empty right now — grab test USDC from the DeepBook faucet.', faucetUrl: OFFICIAL_FAUCET },
        { status: 503 },
      );
    }

    const tx = new Transaction();
    const [primary, ...rest] = coins.map((c) => tx.object(c.coinObjectId));
    if (rest.length) tx.mergeCoins(primary, rest);
    const [drip] = tx.splitCoins(primary, [DRIP]);
    tx.transferObjects([drip], address);

    const res = await client.signAndExecuteTransaction({ signer: faucet, transaction: tx });
    await client.waitForTransaction({ digest: res.digest });

    return NextResponse.json({
      ok: true,
      amount: Number(DRIP) / 1e6,
      digest: res.digest,
      explorer: `https://suiscan.xyz/testnet/tx/${res.digest}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e instanceof Error ? e.message : e), faucetUrl: OFFICIAL_FAUCET },
      { status: 500 },
    );
  }
}

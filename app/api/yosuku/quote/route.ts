// Exact on-chain quote — runs DeepBook Predict's get_trade_amounts / get_range_trade_amounts
// via devInspect in Node (Buffer + SDK stay server-side). Read-only: no funds, no signing.
// Path is /api/yosuku/* to avoid the next.config rewrite that shadows /api/predict/*.
import { NextResponse } from 'next/server';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { getTradeAmountsOnChain, TESTNET } from '@yosuku/deepbook-predict';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RPC = getJsonRpcFullnodeUrl('testnet');
const client = new SuiJsonRpcClient({ url: RPC, network: 'testnet' });
const ZERO = '0x' + '0'.repeat(64);
const leU64 = (b: number[]) => { let v = BigInt(0); for (let i = 0; i < 8; i++) v |= BigInt(b[i] ?? 0) << BigInt(8 * i); return v; };

/** Exact on-chain range quote: range_key::new + predict::get_range_trade_amounts (devInspect). */
async function rangeQuote(oracle: string, expiry: bigint, lower: bigint, higher: bigint, quantity: bigint) {
  const tx = new Transaction();
  const [rk] = tx.moveCall({
    target: `${TESTNET.pkg}::range_key::new`,
    arguments: [tx.pure.id(oracle), tx.pure.u64(expiry), tx.pure.u64(lower), tx.pure.u64(higher)],
  });
  tx.moveCall({
    target: `${TESTNET.pkg}::predict::get_range_trade_amounts`,
    arguments: [tx.object(TESTNET.predict), tx.object(oracle), rk, tx.pure.u64(quantity), tx.object(TESTNET.clock)],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bytes = await tx.build({ client: client as any, onlyTransactionKind: true });
  const res = await (await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sui_devInspectTransactionBlock', params: [ZERO, toBase64(bytes)] }),
  })).json();
  if (res.error) throw new Error(JSON.stringify(res.error));
  const rv = res.result?.results?.at(-1)?.returnValues;
  if (!rv || rv.length < 2) throw new Error(`no return values (status ${res.result?.effects?.status?.status})`);
  return { mintCost: leU64(rv[0][0]), redeemPayout: leU64(rv[1][0]) };
}

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const oracle = u.get('oracle');
  const expiry = u.get('expiry');
  const quantity = u.get('quantity');
  if (!oracle || !expiry || !quantity) {
    return NextResponse.json({ error: 'oracle, expiry, quantity required' }, { status: 400 });
  }
  try {
    // RANGE: needs lower + higher strikes
    if (u.get('kind') === 'range') {
      const lower = u.get('lower');
      const higher = u.get('higher');
      if (!lower || !higher) return NextResponse.json({ error: 'lower, higher required for range' }, { status: 400 });
      const ta = await rangeQuote(oracle, BigInt(expiry), BigInt(lower), BigInt(higher), BigInt(quantity));
      return NextResponse.json({
        mintCost: Number(ta.mintCost) / DUSDC_MULTIPLIER,
        redeemPayout: Number(ta.redeemPayout) / DUSDC_MULTIPLIER,
      });
    }
    // BINARY UP/DOWN
    const strike = u.get('strike');
    const isUp = u.get('isUp') === 'true';
    if (!strike) return NextResponse.json({ error: 'strike required' }, { status: 400 });
    const ta = await getTradeAmountsOnChain(
      client as unknown as { core: unknown },
      RPC,
      TESTNET,
      { oracleId: oracle, expiry: BigInt(expiry), strike: BigInt(strike), isUp, quantity: BigInt(quantity) },
    );
    return NextResponse.json({
      mintCost: Number(ta.mintCost) / DUSDC_MULTIPLIER,
      redeemPayout: Number(ta.redeemPayout) / DUSDC_MULTIPLIER,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}

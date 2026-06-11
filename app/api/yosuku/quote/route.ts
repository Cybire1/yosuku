// Exact on-chain quote — runs @yosuku/deepbook-predict's get_trade_amounts devInspect in Node
// (Buffer + SDK stay server-side). Read-only: no funds, no signing. Path is /api/yosuku/*
// to avoid the next.config rewrite that shadows /api/predict/*.
import { NextResponse } from 'next/server';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { getTradeAmountsOnChain, TESTNET } from '@yosuku/deepbook-predict';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RPC = getJsonRpcFullnodeUrl('testnet');
const client = new SuiJsonRpcClient({ url: RPC, network: 'testnet' });

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const oracle = u.get('oracle');
  const expiry = u.get('expiry');
  const strike = u.get('strike');
  const quantity = u.get('quantity');
  const isUp = u.get('isUp') === 'true';
  if (!oracle || !expiry || !strike || !quantity) {
    return NextResponse.json({ error: 'oracle, expiry, strike, quantity required' }, { status: 400 });
  }
  try {
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

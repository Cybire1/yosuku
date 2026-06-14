// Prove the trustless leverage handshake end-to-end on testnet:
//   TX1 (trader)  request_open  → escrows margin in a shared OpenOrder
//   TX2 (keeper)  fill + deposit + mint → custodies the position in the keeper manager,
//                 mints the Position receipt OWNED BY THE TRADER
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PKG = '0x75e00dc36b96cc4adafd4b180c791f7a0fb40aed92fd11c40968227fc6318a36';
const RESERVE = '0xf715b4b8887b5e6de20f7d7eff5bd07f952f9aafaf65b477330d3c05b8c0cec0';
const MGR = '0x45cd0bb299e63046c6d404af8d97a65bb53c9b6c6b0004f923f029a1042e61e6';
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_ID = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';

const trader = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PKD).secretKey);
const keeper = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PKK).secretKey);
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;
const run = async (signer, tx) => {
  tx.setGasBudget(150_000_000);
  const res = await client.signAndExecuteTransaction({ signer, transaction: tx });
  const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction.digest;
  await new Promise((r) => setTimeout(r, 4000));
  return { digest, tb: await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true }]) };
};

// pick the soonest active BTC oracle
const oracles = await (await fetch('https://predict-server.testnet.mystenlabs.com/oracles')).json();
const o = (Array.isArray(oracles) ? oracles : oracles.data || [])
  .filter((x) => x.status === 'active' && Number(x.expiry) > Date.now()).sort((a, b) => Number(a.expiry) - Number(b.expiry))[0];
// pick an on-grid strike a couple ticks BELOW spot → UP favored + comfortably mintable
const pl = await (await fetch(`https://predict-server.testnet.mystenlabs.com/oracles/${o.oracle_id}/prices/latest`)).json();
let fwd = Number(pl?.forward ?? pl?.spot ?? 0);
if (fwd > 0 && fwd < 1e9) fwd = fwd * 1e9; // dollars → 1e9 scaling
const minS = Number(o.min_strike), tick = Number(o.tick_size);
let sNum = minS + Math.round((fwd - minS) / tick) * tick - 3 * tick; // ~3 ticks ITM for UP
sNum = Math.max(minS + tick, Math.min(sNum, minS + tick * 99999));
const strike = BigInt(sNum);
console.log('oracle', o.oracle_id.slice(0, 10), '· fwd $' + (fwd / 1e9).toFixed(0), '· strike $' + (sNum / 1e9).toFixed(0), '· expires', new Date(Number(o.expiry)).toISOString());

// ── TX1: trader escrows 1 DUSDC margin at 2x ──
const coins = await rpc('suix_getCoins', [trader.toSuiAddress(), DUSDC, null, 5]);
const tx1 = new Transaction();
const [margin] = tx1.splitCoins(tx1.object(coins.data[0].coinObjectId), [1_000_000n]);
tx1.moveCall({
  target: `${PKG}::underwrite::request_open`, typeArguments: [DUSDC],
  arguments: [tx1.object(RESERVE), margin, tx1.pure.u64(20_000), tx1.pure.id(o.oracle_id), tx1.pure.u64(BigInt(o.expiry)),
    tx1.pure.bool(false), tx1.pure.u64(strike), tx1.pure.u64(0n), tx1.pure.bool(true), tx1.object(CLOCK)],
});
const r1 = await run(trader, tx1);
let order;
for (const c of r1.tb?.objectChanges || []) if (String(c.objectType).includes('underwrite::OpenOrder')) order = c.objectId;
console.log('TX1 request_open', JSON.stringify(r1.tb?.effects?.status), '· order', order?.slice(0, 10), r1.digest);

// ── TX2: keeper fills → deposit + mint into the custody manager ──
const QTY = 1_000_000n;
const tx2 = new Transaction();
const notional = tx2.moveCall({ target: `${PKG}::underwrite::fill`, typeArguments: [DUSDC], arguments: [tx2.object(RESERVE), tx2.object(order), tx2.pure.u64(QTY), tx2.object(CLOCK)] });
tx2.moveCall({ target: `${PREDICT}::predict_manager::deposit`, typeArguments: [DUSDC], arguments: [tx2.object(MGR), notional] });
const mk = tx2.moveCall({ target: `${PREDICT}::market_key::up`, arguments: [tx2.pure.id(o.oracle_id), tx2.pure.u64(BigInt(o.expiry)), tx2.pure.u64(strike)] });
tx2.moveCall({ target: `${PREDICT}::predict::mint`, typeArguments: [DUSDC], arguments: [tx2.object(PREDICT_ID), tx2.object(MGR), tx2.object(o.oracle_id), mk, tx2.pure.u64(QTY), tx2.object(CLOCK)] });
const r2 = await run(keeper, tx2);
console.log('TX2 fill+mint  ', JSON.stringify(r2.tb?.effects?.status), r2.digest);
let position;
for (const c of r2.tb?.objectChanges || []) {
  if (String(c.objectType).includes('underwrite::Position')) { position = c.objectId; console.log('  POSITION', c.objectId, '· shared, owner-field →', JSON.stringify(c.owner)); }
}
let rf = (await rpc('sui_getObject', [RESERVE, { showContent: true }]))?.data?.content?.fields;
if (rf) console.log('  reserve · liquid', Number(rf.liquid) / 1e6, '· outstanding', Number(rf.outstanding) / 1e6);

// ── TX3: KEEPER settles the SHARED position (proves the keeper can reference it).
// Using a zero coin (settle-as-loss) just to prove the ownership fix on-chain. ──
const tx3 = new Transaction();
const zero = tx3.moveCall({ target: '0x2::coin::zero', typeArguments: [DUSDC], arguments: [] });
tx3.moveCall({ target: `${PKG}::underwrite::settle`, typeArguments: [DUSDC], arguments: [tx3.object(RESERVE), tx3.object(position), zero] });
const r3 = await run(keeper, tx3);
console.log('TX3 keeper settle', JSON.stringify(r3.tb?.effects?.status), r3.digest);
rf = (await rpc('sui_getObject', [RESERVE, { showContent: true }]))?.data?.content?.fields;
if (rf) console.log('  reserve · liquid', Number(rf.liquid) / 1e6, '· outstanding', Number(rf.outstanding) / 1e6, '(fronted reclaimed/written off)');

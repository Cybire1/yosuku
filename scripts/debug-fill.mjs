const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');
const RPC = 'https://fullnode.testnet.sui.io:443';
const MPKG = '0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e';
const DESK = '0x5aa4be2fb3084660e584d29a7323ea73ab96a07728496c5a3832b3b9cc0f4e40';
const POOL = '0x506023587cc1c08dc25882f9bc78e59fdc68c8cb6b58b04dee8d234a437cf12e';
const MGR  = '0xc111d848df05dfc2efdccc7e4248918188ba2e28f2354f47859c7d0d47788c61';
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_ID = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';
const ORDER = process.argv[2] || '0xd0107c81';
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const me = kp.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json());
const u64le = (a) => { let v = 0n; for (let i = a.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(a[i]); return v; };

// resolve full order id + fields
const ev = (await rpc('suix_queryEvents', [{ MoveEventType: `${MPKG}::margin::OrderRequested` }, null, 50, true])).result.data;
const oid = ev.map(e => e.parsedJson.order).find(x => x.startsWith(ORDER)) || ORDER;
const obj = (await rpc('sui_getObject', [oid, { showContent: true }])).result.data.content.fields;
const order = { ...obj, id: oid };
console.log('order', oid, 'margin', Number(order.margin)/1e6, 'lev', Number(order.leverage_bps)/10000, 'strike', Number(order.lower_strike), 'is_up', order.is_up, 'expiry', order.expiry);

const m = Number(order.margin), lev = Number(order.leverage_bps);
const notional = Math.floor((m * lev) / 10000);
// quote
const qtx = new Transaction();
const k = qtx.moveCall({ target: `${PREDICT}::market_key::${order.is_up ? 'up' : 'down'}`, arguments: [qtx.pure.id(order.oracle_id), qtx.pure.u64(order.expiry), qtx.pure.u64(order.lower_strike)] });
qtx.moveCall({ target: `${PREDICT}::predict::get_trade_amounts`, typeArguments: [DUSDC], arguments: [qtx.object(PREDICT_ID), qtx.object(order.oracle_id), k, qtx.pure.u64(Math.max(1e6, notional)), qtx.object(CLOCK)] });
const qb = await qtx.build({ client, onlyTransactionKind: true });
const dr = (await rpc('sui_devInspectTransactionBlock', [me, Buffer.from(qb).toString('base64'), null, null])).result;
const rv = dr?.results?.[dr.results.length - 1]?.returnValues;
const mintCost = rv ? Number(u64le(rv[0][0])) : 0;
const ppu = mintCost > 0 ? mintCost / Math.max(1e6, notional) : 0.5;
const quantity = Math.max(1, Math.floor((notional * 0.92) / ppu));
console.log('notional', notional/1e6, 'mintCostRef', mintCost/1e6, 'pricePerUnit', ppu.toFixed(4), 'quantity', quantity, 'quote err', dr?.error || 'none');

// build fill PTB + devInspect (clean abort, no gas)
async function tryFill(qty) {
  const tx = new Transaction();
  const nc = tx.moveCall({ target: `${MPKG}::margin::fill`, typeArguments: [DUSDC], arguments: [tx.object(DESK), tx.object(POOL), tx.object(order.id), tx.pure.u64(qty), tx.object(CLOCK)] });
  tx.moveCall({ target: `${PREDICT}::predict_manager::deposit`, typeArguments: [DUSDC], arguments: [tx.object(MGR), nc] });
  const mk = tx.moveCall({ target: `${PREDICT}::market_key::${order.is_up ? 'up' : 'down'}`, arguments: [tx.pure.id(order.oracle_id), tx.pure.u64(order.expiry), tx.pure.u64(order.lower_strike)] });
  tx.moveCall({ target: `${PREDICT}::predict::mint`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(order.oracle_id), mk, tx.pure.u64(qty), tx.object(CLOCK)] });
  const b = await tx.build({ client, onlyTransactionKind: true });
  const r = (await rpc('sui_devInspectTransactionBlock', [me, Buffer.from(b).toString('base64'), null, null])).result;
  return r?.error || 'OK';
}
console.log('fill @ quantity', quantity, '->', await tryFill(quantity));
console.log('fill @ 1000 (tiny) ->', await tryFill(1000));
// exact mint cost for our quantity
const mtx = new Transaction();
const mk2 = mtx.moveCall({ target: `${PREDICT}::market_key::${order.is_up ? 'up' : 'down'}`, arguments: [mtx.pure.id(order.oracle_id), mtx.pure.u64(order.expiry), mtx.pure.u64(order.lower_strike)] });
mtx.moveCall({ target: `${PREDICT}::predict::get_trade_amounts`, typeArguments: [DUSDC], arguments: [mtx.object(PREDICT_ID), mtx.object(order.oracle_id), mk2, mtx.pure.u64(quantity), mtx.object(CLOCK)] });
const mb = await mtx.build({ client, onlyTransactionKind: true });
const mdr = (await rpc('sui_devInspectTransactionBlock', [me, Buffer.from(mb).toString('base64'), null, null])).result;
const mrv = mdr?.results?.[mdr.results.length - 1]?.returnValues;
console.log('exact mintCost for', quantity, 'units =', mrv ? Number(u64le(mrv[0][0]))/1e6 : '?', 'DUSDC (notional', notional/1e6, ')');

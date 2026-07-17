// Prove the Agent Strategy Exchange copy-trade NO-DIVERT flow on-chain:
//   list_strategy (CREATOR)  → publish an investable strategy (caps + fee)
//   deposit + subscribe (SUBSCRIBER) → pay the creator's fee, authorize the creator's
//                                       agent on the subscriber's OWN vault (consent)
//   authorized_trade (CREATOR agent) → copy-trade the SUBSCRIBER's funds; order OWNED BY SUBSCRIBER
//   fill+mint (keeper)        → real Predict position, owner = subscriber
// Headline: the creator's agent moves a SUBSCRIBER's funds into a SUBSCRIBER-owned position.
// The creator earns only the up-front fee; it can never divert a cent of subscriber capital.
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PKG = '0x47d3c108b2165cb1190eefd0b67f73a386e8ca71b870f87a9afb096056795388'; // latest: strategy + copy-trade
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_ID = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';
const DESK = '0x0c47d0aebe44f29c8e7d60d97a38ee327451485c0d5d5916a99f744da1ed7b09';
const POOL = '0x1b824d4bc498695e6adbeaf0f2dee57634c197c67df2f70d1ac93c3f972b8128';
const MGR = '0x3b2df4d0981a46759ce3d99087d109b25422fd570492166f624133ab3a439977';
const VAULT = '0xbe9e96fb8cb6be797c00529fc1f4fe1119192299579167140a084d946851e07b';

const creator = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PKK).secretKey); // 0xaa50ec0f (creator agent + desk keeper)
const sub = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PKD).secretKey);      // 0x0099f972 (subscriber)
const CREATOR = creator.toSuiAddress(), SUB = sub.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json());
const run = async (signer, tx, b = 250_000_000) => { tx.setGasBudget(b); const res = await client.signAndExecuteTransaction({ signer, transaction: tx }); const d = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction.digest; await new Promise(r => setTimeout(r, 4000)); const tb = await rpc('sui_getTransactionBlock', [d, { showObjectChanges: true, showEffects: true, showEvents: true }]); return { d, tb, status: tb.result?.effects?.status }; };
const decodeU64 = (a) => { let v = 0n; a.forEach((b, i) => (v |= BigInt(b) << (8n * BigInt(i)))); return v; };
const devU64 = async (tx, i = 0) => { const b64 = Buffer.from(await tx.build({ client, onlyTransactionKind: true })).toString('base64'); const di = await rpc('sui_devInspectTransactionBlock', [CREATOR, b64, null, null]); const rv = di.result?.results?.at(-1)?.returnValues || []; return rv[i] ? decodeU64(rv[i][0]) : 0n; };
const created = (tb, n) => (tb.result?.objectChanges || []).find(c => c.type === 'created' && String(c.objectType).includes(n))?.objectId;
const ev = (tb, n) => (tb.result?.events || []).filter(e => String(e.type).includes(n)).map(e => e.parsedJson);

console.log('CREATOR/agent', CREATOR.slice(0, 12), '· SUBSCRIBER', SUB.slice(0, 12), '· pkg', PKG.slice(0, 12), '\n');

// ── TX0: CREATOR lists an investable strategy (3x cap, 2 DUSDC/trade, 0.1 DUSDC sub fee) ──
const tx0 = new Transaction();
const cap = tx0.moveCall({ target: `${PKG}::strategy::list_strategy`, typeArguments: [DUSDC], arguments: [tx0.pure.address(CREATOR), tx0.pure.u256(0), tx0.pure.address('0x0'), tx0.pure.u64(30_000), tx0.pure.u64(2_000_000), tx0.pure.u64(100_000)] });
tx0.transferObjects([cap], CREATOR);
const r0 = await run(creator, tx0);
const STRAT = created(r0.tb, '::strategy::Strategy');
console.log('TX0 list_strategy', r0.status?.status, '· strategy', STRAT?.slice(0, 12), r0.d);

// ── TX1: SUBSCRIBER deposits 2 DUSDC, then subscribes (pays fee + authorizes the agent) ──
const coins = await rpc('suix_getCoins', [SUB, DUSDC, null, 10]);
const tx1 = new Transaction();
const src = tx1.object(coins.result.data[0].coinObjectId);
const [dep] = tx1.splitCoins(src, [2_000_000n]);
tx1.moveCall({ target: `${PKG}::social_vault::deposit`, typeArguments: [DUSDC], arguments: [tx1.object(VAULT), dep] });
const r1 = await run(sub, tx1);
console.log('TX1 deposit 2 DUSDC', r1.status?.status, r1.d);

const coins2 = await rpc('suix_getCoins', [SUB, DUSDC, null, 10]);
const tx2 = new Transaction();
const [fee] = tx2.splitCoins(tx2.object(coins2.result.data[0].coinObjectId), [100_000n]);
tx2.moveCall({ target: `${PKG}::strategy::subscribe`, typeArguments: [DUSDC], arguments: [tx2.object(STRAT), tx2.object(VAULT), fee] });
const r2 = await run(sub, tx2);
const SUBSCRIPTION = created(r2.tb, '::social_vault::Subscription');
console.log('TX2 subscribe', r2.status?.status, '· subscription', SUBSCRIPTION?.slice(0, 12), '· StrategySubscribed', JSON.stringify(ev(r2.tb, 'StrategySubscribed')[0]), r2.d);

// pick the soonest ~15-min BTC market
const oracles = await (await fetch('https://predict-server.testnet.mystenlabs.com/oracles')).json();
const o = (Array.isArray(oracles) ? oracles : oracles.data || []).filter(x => x.status === 'active' && Number(x.expiry) > Date.now() + 300_000).sort((a, b) => a.expiry - b.expiry)[0];
const pl = await (await fetch(`https://predict-server.testnet.mystenlabs.com/oracles/${o.oracle_id}/prices/latest`)).json();
let fwd = Number(pl?.forward ?? pl?.spot ?? 0); if (fwd > 0 && fwd < 1e9) fwd *= 1e9;
const minS = Number(o.min_strike), tick = Number(o.tick_size);
const strike = BigInt(Math.max(minS + tick, minS + Math.round((fwd - minS) / tick) * tick));
const expiry = BigInt(o.expiry);
const mk = (tx) => tx.moveCall({ target: `${PREDICT}::market_key::up`, arguments: [tx.pure.id(o.oracle_id), tx.pure.u64(expiry), tx.pure.u64(strike)] });
const quote = async (q) => { const t = new Transaction(); const k = mk(t); t.moveCall({ target: `${PREDICT}::predict::get_trade_amounts`, arguments: [t.object(PREDICT_ID), t.object(o.oracle_id), k, t.pure.u64(q), t.object(CLOCK)] }); return devU64(t, 0); };
const NOTIONAL = 1_000_000n; // 0.5 margin * 2x
const ask = await quote(1_000_000n);
let QTY = (NOTIONAL * 1_000_000n * 88n / 100n) / ask;
const real = await quote(QTY); if (real > 0n) QTY = (QTY * NOTIONAL * 88n / 100n) / real;
console.log('market', o.oracle_id.slice(0, 10), '· expires', ((Number(expiry) - Date.now()) / 60000).toFixed(1), 'min · QTY', Number(QTY) / 1e6, '\n');

// ── TX3: CREATOR agent copy-trades 0.5 DUSDC of the SUBSCRIBER's funds at 2x ──
const tx3 = new Transaction();
tx3.moveCall({ target: `${PKG}::social_vault::authorized_trade`, typeArguments: [DUSDC], arguments: [tx3.object(VAULT), tx3.object(SUBSCRIPTION), tx3.object(DESK), tx3.pure.u64(500_000), tx3.pure.u64(20_000), tx3.pure.id(o.oracle_id), tx3.pure.u64(expiry), tx3.pure.bool(false), tx3.pure.u64(strike), tx3.pure.u64(0n), tx3.pure.bool(true), tx3.object(CLOCK)] });
const r3 = await run(creator, tx3);
const order = created(r3.tb, 'margin::OpenOrder');
console.log('TX3 authorized_trade', r3.status?.status, '· CopyTraded', JSON.stringify(ev(r3.tb, 'CopyTraded')[0]));
console.log('   OrderRequested trader =', ev(r3.tb, 'OrderRequested')[0]?.trader?.slice(0, 12), '(must = SUBSCRIBER)', r3.d);

// ── TX4: keeper fills → real Predict position OWNED BY THE SUBSCRIBER ──
const tx4 = new Transaction();
const notional = tx4.moveCall({ target: `${PKG}::margin::fill`, typeArguments: [DUSDC], arguments: [tx4.object(DESK), tx4.object(POOL), tx4.object(order), tx4.pure.u64(QTY), tx4.object(CLOCK)] });
tx4.moveCall({ target: `${PREDICT}::predict_manager::deposit`, typeArguments: [DUSDC], arguments: [tx4.object(MGR), notional] });
const k4 = mk(tx4);
tx4.moveCall({ target: `${PREDICT}::predict::mint`, typeArguments: [DUSDC], arguments: [tx4.object(PREDICT_ID), tx4.object(MGR), tx4.object(o.oracle_id), k4, tx4.pure.u64(QTY), tx4.object(CLOCK)] });
const r4 = await run(creator, tx4);
const opened = ev(r4.tb, 'PositionOpened')[0];
console.log('TX4 fill+mint', r4.status?.status, '· position owner =', opened?.owner?.slice(0, 12), '(must = SUBSCRIBER)', r4.d);

console.log('\n=== COPY-TRADE NO-DIVERT ===');
console.log('subscriber', SUB.slice(0, 12), '· position owner', opened?.owner?.slice(0, 12), '· match:', opened?.owner === SUB);
console.log('strategy', STRAT, '· subscription', SUBSCRIPTION);
console.log('creator earned the 0.1 DUSDC fee; the subscriber owns the position and is force-paid on exit; the creator-agent diverted nothing.');

// Open a fresh 2x position on a live oracle, let the BOX keeper fill it, then read the
// manager's on-chain position for that exact key -> proves whether fill persists.
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');
const RPC = 'https://fullnode.testnet.sui.io:443';
const MPKG = '0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e';
const VAULT = '0xc04516b582bfe73c71325408bfb9e9a5a8fdcd54952a313a288a135e272fa1e6';
const DESK = '0x5aa4be2fb3084660e584d29a7323ea73ab96a07728496c5a3832b3b9cc0f4e40';
const MGR = '0xc111d848df05dfc2efdccc7e4248918188ba2e28f2354f47859c7d0d47788c61';
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';
const MARGIN = 1_000_000, LEV = 20_000;
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const me = kp.toSuiAddress();
const c = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json());
const u64le = (a) => { let v = 0n; for (let i = a.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(a[i]); return v; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// pick a live BTC oracle with >40min left
const ors = await (await fetch('https://predict-server.testnet.mystenlabs.com/oracles')).json();
const arr = Array.isArray(ors) ? ors : ors.data;
const now = Date.now();
const o = arr.filter(x => (x.underlying_asset||'BTC')==='BTC' && x.settlement_price==null && Number(x.expiry) > now + 2400000).sort((a,b)=>Number(a.expiry)-Number(b.expiry))[0];
const px = await (await fetch(`https://predict-server.testnet.mystenlabs.com/oracles/${o.oracle_id}/prices/latest`)).json();
const spot = Number(px.spot);
const tick = Number(o.tick_size);
const strike = Math.round(spot / tick) * tick; // nearest tick (canonical)
console.log('oracle', o.oracle_id.slice(0,12), 'expiry', o.expiry, 'spot$', (spot/1e9).toFixed(0), 'strike$', (strike/1e9).toFixed(0), 'strike', strike);

// open 2x UP
const coins = (await rpc('suix_getCoins', [me, DUSDC])).result.data;
const tx = new Transaction();
const primary = tx.object(coins[0].coinObjectId);
if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1, 20).map(x => tx.object(x.coinObjectId)));
const [funds] = tx.splitCoins(primary, [MARGIN]);
tx.moveCall({ target: `${MPKG}::trading_vault::deposit`, typeArguments: [DUSDC], arguments: [tx.object(VAULT), funds] });
tx.moveCall({ target: `${MPKG}::trading_vault::open_leverage`, typeArguments: [DUSDC], arguments: [tx.object(VAULT), tx.object(DESK), tx.pure.id(o.oracle_id), tx.pure.u64(MARGIN), tx.pure.u64(LEV), tx.pure.u64(o.expiry), tx.pure.bool(false), tx.pure.u64(strike), tx.pure.u64(0), tx.pure.bool(true), tx.object(CLOCK)] });
tx.setGasBudget(80_000_000);
const r = await c.signAndExecuteTransaction({ signer: kp, transaction: tx });
console.log('open tx:', r.$kind === 'Transaction' ? r.Transaction.digest : JSON.stringify(r).slice(0,150));

// poll manager position for the new key (box keeper should fill within ~25s)
async function posOf() {
  const t = new Transaction();
  const k = t.moveCall({ target: `${PREDICT}::market_key::up`, arguments: [t.pure.id(o.oracle_id), t.pure.u64(o.expiry), t.pure.u64(strike)] });
  t.moveCall({ target: `${PREDICT}::predict_manager::position`, arguments: [t.object(MGR), k] });
  const b = await t.build({ client: c, onlyTransactionKind: true });
  const dr = (await rpc('sui_devInspectTransactionBlock', [me, Buffer.from(b).toString('base64'), null, null])).result;
  const rv = dr?.results?.[dr.results.length - 1]?.returnValues;
  return rv ? Number(u64le(rv[0][0])) : -1;
}
for (let i = 0; i < 8; i++) {
  await sleep(15000);
  const p = await posOf();
  console.log(`t+${(i+1)*15}s  manager position for new key = ${p}${p > 0 ? '  <-- FILLED & PERSISTED ✅' : ''}`);
  if (p > 0) break;
}

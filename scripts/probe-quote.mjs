// Probe several oracles/strikes for a healthy (non-zero) up-binary quote.
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_ID = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';

const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PKK).secretKey);
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json());
const decodeU64 = (arr) => { let v = 0n; arr.forEach((b, i) => (v |= BigInt(b) << (8n * BigInt(i)))); return v; };

async function quote(o, strike, isUp, QTY = 5_000_000n) {
  const tx = new Transaction();
  const fn = isUp ? 'up' : 'down';
  const mk = tx.moveCall({ target: `${PREDICT}::market_key::${fn}`, arguments: [tx.pure.id(o.oracle_id), tx.pure.u64(BigInt(o.expiry)), tx.pure.u64(strike)] });
  tx.moveCall({ target: `${PREDICT}::predict::get_trade_amounts`, arguments: [tx.object(PREDICT_ID), tx.object(o.oracle_id), mk, tx.pure.u64(QTY), tx.object(CLOCK)] });
  const b64 = Buffer.from(await tx.build({ client, onlyTransactionKind: true })).toString('base64');
  const di = await rpc('sui_devInspectTransactionBlock', [kp.toSuiAddress(), b64, null, null]);
  if (di.error || di.result?.error) return { err: di.error?.message || di.result?.error };
  const rv = di.result?.results?.at(-1)?.returnValues || [];
  return { ask: rv[0] ? decodeU64(rv[0][0]) : 0n, bid: rv[1] ? decodeU64(rv[1][0]) : 0n };
}

const oracles = await (await fetch('https://predict-server.testnet.mystenlabs.com/oracles')).json();
const list = (Array.isArray(oracles) ? oracles : oracles.data || [])
  .filter((x) => x.status === 'active' && Number(x.expiry) > Date.now() + 3600_000).sort((a, b) => Number(a.expiry) - Number(b.expiry));
console.log('active oracles (>1h out):', list.length);

for (const o of list.slice(0, 4)) {
  const pl = await (await fetch(`https://predict-server.testnet.mystenlabs.com/oracles/${o.oracle_id}/prices/latest`)).json();
  let fwd = Number(pl?.forward ?? pl?.spot ?? 0);
  if (fwd > 0 && fwd < 1e9) fwd = fwd * 1e9;
  const minS = Number(o.min_strike), tick = Number(o.tick_size);
  const atm = minS + Math.round((fwd - minS) / tick) * tick;
  const hrs = ((Number(o.expiry) - Date.now()) / 3600_000).toFixed(1);
  console.log(`\noracle ${o.oracle_id.slice(0, 10)} · fwd $${(fwd / 1e9).toFixed(0)} · tick $${(tick / 1e9).toFixed(0)} · ${hrs}h out`);
  for (const off of [-10, -3, 0, 3, 10]) {
    const s = BigInt(Math.max(minS + tick, atm + off * tick));
    const q = await quote(o, s, true);
    if (q.err) { console.log(`  UP strike $${(Number(s) / 1e9).toFixed(0)} (atm${off >= 0 ? '+' : ''}${off})  ERR ${q.err.slice(0, 50)}`); continue; }
    console.log(`  UP strike $${(Number(s) / 1e9).toFixed(0)} (atm${off >= 0 ? '+' : ''}${off})  ask/sh ${(Number(q.ask) / 5e6).toFixed(4)} · bid/sh ${(Number(q.bid) / 5e6).toFixed(4)} · bid/ask ${q.ask ? (Number(q.bid) / Number(q.ask)).toFixed(3) : 'n/a'}`);
  }
}

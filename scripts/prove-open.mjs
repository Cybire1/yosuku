// Prove the leveraged-open PTB end-to-end: underwrite::open (reserve fronts) →
// deposit into the keeper-owned manager → mint a Predict position. Signed by a
// trader key (PK). Opens a small 2x UP position at min_strike (deep ITM → valid
// market + likely win, so the keeper can later settle it).
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PKG = '0x9e2e07a4e756db87c021460e9e2e65499d7d37a3d7e4a53b510ae265a2d814e2';
const RESERVE = '0xaf03fd11086dcb5d7c2ae1667c1f08f3379fa05a8e47bbc02987f62300d653ea';
const MGR = '0x45cd0bb299e63046c6d404af8d97a65bb53c9b6c6b0004f923f029a1042e61e6';
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_ID = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';

const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const me = kp.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;

const oracles = await (await fetch('https://predict-server.testnet.mystenlabs.com/oracles')).json();
const o = (Array.isArray(oracles) ? oracles : oracles.data || [])
  .filter((x) => x.status === 'active' && Number(x.expiry) > Date.now() && (x.underlying_asset || 'BTC') === 'BTC')
  .sort((a, b) => Number(a.expiry) - Number(b.expiry))[0];
console.log('oracle', o.oracle_id, '· expiry', new Date(Number(o.expiry)).toISOString(), '· min_strike', o.min_strike);

const coins = await rpc('suix_getCoins', [me, DUSDC, null, 5]);
const coin = coins.data[0].coinObjectId;
const MARGIN = 1_000_000n;     // 1 DUSDC
const LEV_BPS = 20_000;        // 2x
const QTY = 1_000_000n;        // 1 unit
const strike = BigInt(o.min_strike);

const tx = new Transaction();
const [margin] = tx.splitCoins(tx.object(coin), [MARGIN]);
const open = tx.moveCall({
  target: `${PKG}::underwrite::open`, typeArguments: [DUSDC],
  arguments: [
    tx.object(RESERVE), margin, tx.pure.u64(LEV_BPS),
    tx.pure.id(MGR), tx.pure.id(o.oracle_id), tx.pure.u64(BigInt(o.expiry)),
    tx.pure.bool(false), tx.pure.u64(strike), tx.pure.u64(0n), tx.pure.bool(true), tx.pure.u64(QTY),
    tx.object(CLOCK),
  ],
});
tx.moveCall({ target: `${PREDICT}::predict_manager::deposit`, typeArguments: [DUSDC], arguments: [tx.object(MGR), open[1]] });
const mk = tx.moveCall({ target: `${PREDICT}::market_key::up`, arguments: [tx.pure.id(o.oracle_id), tx.pure.u64(BigInt(o.expiry)), tx.pure.u64(strike)] });
tx.moveCall({ target: `${PREDICT}::predict::mint`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(o.oracle_id), mk, tx.pure.u64(QTY), tx.object(CLOCK)] });
tx.transferObjects([open[0]], tx.pure.address(me));
tx.setGasBudget(80_000_000);

let res;
try {
  res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
} catch (e) {
  console.log('EXEC ERROR:', e?.message || String(e));
  if (e?.cause) console.log('cause:', JSON.stringify(e.cause).slice(0, 400));
  // dry-run for the precise abort
  const built = await tx.build({ client });
  const dr = await rpc('sui_dryRunTransactionBlock', [Buffer.from(built).toString('base64')]);
  console.log('dryRun status:', JSON.stringify(dr?.effects?.status));
  process.exit(1);
}
const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction.digest;
await new Promise((r) => setTimeout(r, 4000));
const tb = await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true }]);
console.log('status', JSON.stringify(tb?.effects?.status), digest);
for (const c of tb?.objectChanges || []) {
  if (String(c.objectType).includes('underwrite::Position')) console.log('POSITION', c.objectId);
}
const rf = (await rpc('sui_getObject', [RESERVE, { showContent: true }]))?.data?.content?.fields;
if (rf) console.log('reserve · liquid', Number(rf.liquid) / 1e6, '· outstanding', Number(rf.outstanding) / 1e6);

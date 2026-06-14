// Stand up the margin desk on testnet:
//   1) lending_pool::create + seed (LP supplies DUSDC)
//   2) predict::create_manager  → the AGENT-owned custody manager (keeper signs → keeper owns it)
//   3) margin::create_desk        → binds keeper + custody manager + pool, sets risk params
// Prints POOL / MGR / DESK ids to feed prove-margin-liquidation.mjs.
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PKG = '0xa3b75354df203da7b434efb55f6573f72fb656e3897082b575be86dc291cee44';
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';
const SEED = 20_000_000n; // 20 DUSDC pool liquidity

const keeper = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PKK).secretKey);
const lp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PKD).secretKey);
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;
const run = async (signer, tx, budget = 200_000_000) => {
  tx.setGasBudget(budget);
  const res = await client.signAndExecuteTransaction({ signer, transaction: tx });
  const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction.digest;
  await new Promise((r) => setTimeout(r, 4000));
  const tb = await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true }]);
  return { digest, tb };
};
const created = (tb, needle) => (tb?.objectChanges || []).find((c) => c.type === 'created' && String(c.objectType).includes(needle))?.objectId;

console.log('keeper', keeper.toSuiAddress().slice(0, 10), '· LP', lp.toSuiAddress().slice(0, 10), '· pkg', PKG.slice(0, 10));

// 1) create lending pool (0% interest for clean accounting) — keeper signs (admin)
const txa = new Transaction();
txa.moveCall({ target: `${PKG}::lending_pool::create`, typeArguments: [DUSDC], arguments: [txa.pure.u64(0), txa.pure.u64(0), txa.object(CLOCK)] });
const ra = await run(keeper, txa);
const POOL = created(ra.tb, 'lending_pool::LendingPool');
console.log('POOL', POOL, JSON.stringify(ra.tb?.effects?.status), ra.digest);

// 2) seed the pool — LP supplies DUSDC, keeps the SupplyPosition
const coins = await rpc('suix_getCoins', [lp.toSuiAddress(), DUSDC, null, 10]);
const txb = new Transaction();
const [seed] = txb.splitCoins(txb.object(coins.data[0].coinObjectId), [SEED]);
const sp = txb.moveCall({ target: `${PKG}::lending_pool::supply`, typeArguments: [DUSDC], arguments: [txb.object(POOL), seed, txb.object(CLOCK)] });
txb.transferObjects([sp], lp.toSuiAddress());
const rb = await run(lp, txb);
console.log('seed', Number(SEED) / 1e6, 'DUSDC', JSON.stringify(rb.tb?.effects?.status), rb.digest);

// 3) create the agent-owned custody manager — keeper signs → keeper is the owner
const txc = new Transaction();
txc.moveCall({ target: `${PREDICT}::predict::create_manager`, arguments: [] });
const rc = await run(keeper, txc);
const MGR = created(rc.tb, 'predict_manager::PredictManager');
console.log('MGR (custody)', MGR, JSON.stringify(rc.tb?.effects?.status), rc.digest);

// 4) create the margin desk — 3x max, 120% maintenance, 5% liq penalty, bound to keeper + MGR + POOL
const txd = new Transaction();
txd.moveCall({
  target: `${PKG}::margin::create_desk`, typeArguments: [DUSDC],
  arguments: [txd.object(POOL), txd.pure.address(keeper.toSuiAddress()), txd.pure.id(MGR), txd.pure.u64(30_000), txd.pure.u64(12_000), txd.pure.u64(500)],
});
const rd = await run(keeper, txd);
const DESK = created(rd.tb, 'margin::MarginDesk');
console.log('DESK', DESK, JSON.stringify(rd.tb?.effects?.status), rd.digest);

console.log('\n=== EXPORTS ===');
console.log(`POOL=${POOL}`);
console.log(`MGR=${MGR}`);
console.log(`DESK=${DESK}`);

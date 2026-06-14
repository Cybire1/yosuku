// Create the underwriting Reserve<DUSDC> and seed it with DUSDC.
import fs from 'fs';
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PKG = process.env.PKG;
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';
const SEED = BigInt(process.env.SEED || '0'); // micro DUSDC to seed; 0 = create only

const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const addr = kp.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;

const exec = async (tx) => {
  const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
  const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction.digest;
  await new Promise((r) => setTimeout(r, 4000));
  return { digest, tb: await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true }]) };
};

// DUSDC balance
const coins = await rpc('suix_getCoins', [addr, DUSDC, null, 50]);
const total = (coins?.data || []).reduce((s, c) => s + BigInt(c.balance), 0n);
console.log('publisher DUSDC:', Number(total) / 1e6, '· coins', coins?.data?.length || 0);

// 1) create the reserve (skip if RESERVE provided): keeper + custody mgr, 3x / 8% / 60%
const KEEPER = process.env.KEEPER;
const MGR = process.env.MGR;
let reserve = process.env.RESERVE;
if (!reserve) {
  const tx1 = new Transaction();
  tx1.moveCall({ target: `${PKG}::underwrite::create`, typeArguments: [DUSDC], arguments: [tx1.pure.address(KEEPER), tx1.pure.id(MGR), tx1.pure.u64(30_000), tx1.pure.u64(800), tx1.pure.u64(6_000)] });
  tx1.setGasBudget(60_000_000);
  const r1 = await exec(tx1);
  console.log('create status', JSON.stringify(r1.tb?.effects?.status), r1.digest);
  for (const c of r1.tb?.objectChanges || []) {
    if (String(c.objectType).includes('underwrite::Reserve')) { reserve = c.objectId; console.log('RESERVE_ID', c.objectId); }
  }
} else {
  console.log('using existing RESERVE', reserve);
}

// 2) seed it
if (SEED > 0n && reserve && total >= SEED) {
  const ids = coins.data.map((c) => c.coinObjectId);
  const tx2 = new Transaction();
  const primary = tx2.object(ids[0]);
  if (ids.length > 1) tx2.mergeCoins(primary, ids.slice(1).map((i) => tx2.object(i)));
  const [seed] = tx2.splitCoins(primary, [SEED]);
  const sp = tx2.moveCall({ target: `${PKG}::underwrite::supply`, typeArguments: [DUSDC], arguments: [tx2.object(reserve), seed] });
  tx2.transferObjects([sp], tx2.pure.address(addr));
  tx2.setGasBudget(60_000_000);
  const r2 = await exec(tx2);
  console.log('seed status', JSON.stringify(r2.tb?.effects?.status), r2.digest, '· seeded', Number(SEED) / 1e6, 'DUSDC');
} else {
  console.log('skip seed (SEED', Number(SEED) / 1e6, '· have', Number(total) / 1e6, ')');
}

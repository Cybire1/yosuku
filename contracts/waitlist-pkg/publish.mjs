// Publish the waitlist package via the SDK (bypasses the CLI proto panic). init() shares
// the Waitlist object at publish; we capture both the package id and that shared object.
import fs from 'fs';
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const build = JSON.parse(fs.readFileSync('/tmp/waitlist-build.json', 'utf8'));
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;

console.log('publisher', kp.toSuiAddress().slice(0, 12), '· modules', build.modules.length);
const tx = new Transaction();
const [cap] = tx.publish({ modules: build.modules, dependencies: build.dependencies });
tx.transferObjects([cap], kp.toSuiAddress());
tx.setGasBudget(200_000_000);
const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction.digest;
console.log('digest', digest);
await new Promise((r) => setTimeout(r, 5000));
const tb = await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true }]);
console.log('status', JSON.stringify(tb?.effects?.status));
for (const c of tb?.objectChanges || []) {
  if (c.type === 'published') console.log('PACKAGE_ID', c.packageId);
  if (c.type === 'created' && String(c.objectType).includes('::waitlist::Waitlist')) console.log('WAITLIST_ID', c.objectId);
}

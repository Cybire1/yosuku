// Upgrade the live yolev package (adds social_vault + margin::request_open_for) via the
// SDK, bypassing the CLI's protocol-version panic. Signs with the keeper key that owns
// the UpgradeCap. Preserves the deployed desk / pool / custody manager / enclave binding.
import fs from 'fs';
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PKG = '0xa3b75354df203da7b434efb55f6573f72fb656e3897082b575be86dc291cee44';
const CAP = '0xb9c19a789f170d96f244e1eaa461719b3f9f4dc736e028d812b2eab946f95fdf';
const build = JSON.parse(fs.readFileSync('/tmp/yolev-upgrade.json', 'utf8'));

const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PKK).secretKey);
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;

console.log('signer', kp.toSuiAddress().slice(0, 12), '· modules', build.modules.length, '· cap', CAP.slice(0, 12));

const tx = new Transaction();
const cap = tx.object(CAP);
const ticket = tx.moveCall({
  target: '0x2::package::authorize_upgrade',
  arguments: [cap, tx.pure.u8(0 /* COMPATIBLE */), tx.pure.vector('u8', build.digest)],
});
const receipt = tx.upgrade({ modules: build.modules, dependencies: build.dependencies, package: PKG, ticket });
tx.moveCall({ target: '0x2::package::commit_upgrade', arguments: [cap, receipt] });
tx.setGasBudget(800_000_000);

const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction.digest;
console.log('digest', digest);
await new Promise((r) => setTimeout(r, 5000));
const tb = await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true }]);
console.log('status', JSON.stringify(tb?.effects?.status));
for (const c of tb?.objectChanges || []) {
  if (c.type === 'published') console.log('NEW_PACKAGE_ID', c.packageId);
}

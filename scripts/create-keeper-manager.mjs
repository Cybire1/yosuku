// Create the protocol-owned (keeper-owned) shared PredictManager that custodies
// all leveraged positions. Owner = the signing keeper key, so only the keeper can
// withdraw redeemed proceeds — closing the reclaim hole.
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;

console.log('keeper', kp.toSuiAddress());
const tx = new Transaction();
tx.moveCall({ target: `${PREDICT}::predict::create_manager` });
tx.setGasBudget(60_000_000);
const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction.digest;
await new Promise((r) => setTimeout(r, 4000));
const tb = await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true }]);
console.log('status', JSON.stringify(tb?.effects?.status), digest);
for (const c of tb?.objectChanges || []) {
  if (String(c.objectType).includes('PredictManager')) console.log('LEVERAGE_MANAGER_ID', c.objectId, '·', c.type);
}

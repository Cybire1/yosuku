const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = process.env.SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';
const PREDICT_PACKAGE_ID =
  process.env.PREDICT_PACKAGE_ID ?? '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PK = process.env.EXECUTOR_PRIVATE_KEY ?? process.env.PRIVATE_BET_EXECUTOR_PRIVATE_KEY ?? process.env.PK;

if (!PK) {
  console.error('Set EXECUTOR_PRIVATE_KEY=suiprivkey...');
  process.exit(1);
}

const signer = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(PK).secretKey);
const client = new SuiJsonRpcClient({ url: RPC, network: process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet' });
const tx = new Transaction();
tx.moveCall({ target: `${PREDICT_PACKAGE_ID}::predict::create_manager` });
tx.setGasBudget(60_000_000);

console.log('executor', signer.toSuiAddress());
const res = await client.signAndExecuteTransaction({
  signer,
  transaction: tx,
  options: { showEffects: true, showObjectChanges: true },
});
await client.waitForTransaction({ digest: res.digest });
console.log('digest', res.digest);
console.log('status', JSON.stringify(res.effects?.status));
for (const change of res.objectChanges ?? []) {
  if (change.type === 'created' && String(change.objectType).includes('PredictManager')) {
    console.log('PREDICT_MANAGER_ID=' + change.objectId);
  }
}

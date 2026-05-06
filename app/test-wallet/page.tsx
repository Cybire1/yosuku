'use client';

import { useState } from 'react';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { fetchDUSDCBalance, fetchDUSDCCoins } from '@/lib/sui/queries';
import { PACKAGE_ID, PREDICT_ID, REGISTRY_ID, DUSDC_TYPE } from '@/lib/sui/constants';

export default function TestWalletPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const client = useSuiClient();
  const [logs, setLogs] = useState<string[]>([]);

  const log = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLogs(prev => [`[${ts}] ${msg}`, ...prev]);
    console.log(`[TestWallet] ${msg}`);
  };

  const testDUSDCBalance = async () => {
    log('--- DUSDC Balance ---');
    if (!address) {
      log('ERROR: No wallet connected');
      return;
    }
    try {
      const balance = await fetchDUSDCBalance(client, address);
      log(`SUCCESS: ${balance} micro DUSDC (${(balance / 1_000_000).toFixed(2)} DUSDC)`);
    } catch (err: any) {
      log(`ERROR: ${err?.message || err}`);
    }
  };

  const testDUSDCCoins = async () => {
    log('--- DUSDC Coins ---');
    if (!address) {
      log('ERROR: No wallet connected');
      return;
    }
    try {
      const coins = await fetchDUSDCCoins(client, address);
      log(`SUCCESS: ${coins.length} coin objects`);
      coins.forEach((c, i) => {
        log(`  Coin[${i}]: ${c.coinObjectId} — ${c.balance} micro`);
      });
    } catch (err: any) {
      log(`ERROR: ${err?.message || err}`);
    }
  };

  const testFetchOwnedObjects = async () => {
    log('--- Owned Objects (PredictManager) ---');
    if (!address) {
      log('ERROR: No wallet connected');
      return;
    }
    try {
      const result = await client.getOwnedObjects({
        owner: address,
        filter: { Package: PACKAGE_ID },
        options: { showType: true, showContent: true },
      });
      log(`SUCCESS: ${result.data.length} objects from package`);
      result.data.forEach((obj, i) => {
        const type = obj.data?.type || 'unknown';
        log(`  Object[${i}]: ${obj.data?.objectId} — ${type}`);
      });
    } catch (err: any) {
      log(`ERROR: ${err?.message || err}`);
    }
  };

  const testPredictObject = async () => {
    log('--- Predict Shared Object ---');
    try {
      const obj = await client.getObject({
        id: PREDICT_ID,
        options: { showType: true, showContent: true },
      });
      log(`SUCCESS: ${obj.data?.objectId}`);
      log(`  Type: ${obj.data?.type}`);
      const content = obj.data?.content;
      if (content && 'fields' in content) {
        const fields = content.fields as Record<string, unknown>;
        log(`  Fields: ${Object.keys(fields).join(', ')}`);
      }
    } catch (err: any) {
      log(`ERROR: ${err?.message || err}`);
    }
  };

  const dumpConfig = () => {
    log('--- Contract Config ---');
    log(`  Package: ${PACKAGE_ID}`);
    log(`  Registry: ${REGISTRY_ID}`);
    log(`  Predict: ${PREDICT_ID}`);
    log(`  DUSDC Type: ${DUSDC_TYPE}`);
  };

  return (
    <div className="min-h-screen bg-black text-white p-6 font-mono">
      <h1 className="text-xl font-bold mb-4">Sui Wallet Debug</h1>

      <div className="mb-4 p-3 bg-neutral-900 rounded-lg border border-white/10">
        <p>Address: <span className="text-new-mint">{address || 'not connected'}</span></p>
        <p>Connected: {address ? 'YES' : 'NO'}</p>
        <p>Network: <span className="text-yellow-400">Sui Testnet</span></p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={dumpConfig} className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">
          Dump Config
        </button>
        <button onClick={testDUSDCBalance} className="px-3 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm">
          DUSDC Balance
        </button>
        <button onClick={testDUSDCCoins} className="px-3 py-2 bg-sky-800 hover:bg-sky-700 rounded-lg text-sm">
          DUSDC Coins
        </button>
        <button onClick={testFetchOwnedObjects} className="px-3 py-2 bg-purple-700 hover:bg-purple-600 rounded-lg text-sm">
          Owned Objects
        </button>
        <button onClick={testPredictObject} className="px-3 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm">
          Predict Object
        </button>
        <button onClick={() => setLogs([])} className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-gray-500">
          Clear
        </button>
      </div>

      <div className="bg-neutral-950 border border-white/10 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
        {logs.length === 0 ? (
          <p className="text-gray-600 text-sm">Connect wallet and click a button above...</p>
        ) : (
          logs.map((line, i) => (
            <p key={i} className={`text-xs leading-relaxed ${
              line.includes('ERROR') ? 'text-off-red' :
              line.includes('SUCCESS') ? 'text-new-mint' :
              line.includes('---') ? 'text-yellow-400 font-bold mt-2' :
              'text-gray-400'
            }`}>
              {line}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

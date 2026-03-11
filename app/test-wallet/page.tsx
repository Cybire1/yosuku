'use client';

import { useState } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';

export default function TestWalletPage() {
  const wallet = useWallet();
  const [logs, setLogs] = useState<string[]>([]);

  const log = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLogs(prev => [`[${ts}] ${msg}`, ...prev]);
    console.log(`[TestWallet] ${msg}`);
  };

  const testRequestRecords = async (program: string) => {
    log(`--- requestRecords("${program}") ---`);
    if (!wallet.requestRecords) {
      log('ERROR: requestRecords is undefined on wallet object');
      return;
    }
    try {
      const records = await wallet.requestRecords(program);
      log(`SUCCESS: got ${records?.length ?? 0} records`);
      if (records && records.length > 0) {
        records.forEach((r: any, i: number) => {
          const str = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
          log(`  Record[${i}]: ${str.slice(0, 300)}${str.length > 300 ? '...' : ''}`);
        });
      } else {
        log('  (empty array returned)');
      }
    } catch (err: any) {
      log(`ERROR: ${err?.message || err}`);
      if (err?.code) log(`  Error code: ${err.code}`);
      if (err?.name) log(`  Error name: ${err.name}`);
      log(`  Full error: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`);
    }
  };

  const testDecrypt = async () => {
    log('--- decrypt test ---');
    if (!wallet.decrypt) {
      log('ERROR: decrypt is undefined on wallet object');
      return;
    }
    try {
      const result = await wallet.decrypt('test_ciphertext');
      log(`SUCCESS: ${JSON.stringify(result)}`);
    } catch (err: any) {
      log(`ERROR: ${err?.message || err}`);
    }
  };

  const testTransactionHistory = async () => {
    log('--- requestTransactionHistory ---');
    if (!wallet.requestTransactionHistory) {
      log('ERROR: requestTransactionHistory is undefined');
      return;
    }
    try {
      const history: any = await wallet.requestTransactionHistory('btc_pred_v10.aleo');
      const arr = Array.isArray(history) ? history : history?.transactions ?? [];
      log(`SUCCESS: type=${typeof history}, isArray=${Array.isArray(history)}, keys=${Object.keys(history || {}).join(',')}`);
      log(`  Items: ${arr.length}`);
      arr.slice(0, 3).forEach((tx: any, i: number) => {
        log(`  TX[${i}]: ${JSON.stringify(tx).slice(0, 200)}`);
      });
    } catch (err: any) {
      log(`ERROR: ${err?.message || err}`);
      log(`  Full error: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`);
    }
  };

  const testSignMessage = async () => {
    const testMsg = 'DART_v9_round_1';
    log(`--- signMessage("${testMsg}") attempt 1 ---`);
    if (!(wallet as any).signMessage) {
      log('ERROR: signMessage is undefined on wallet object');
      return;
    }
    try {
      const sig1: any = await (wallet as any).signMessage(new TextEncoder().encode(testMsg));
      const sig1Str = typeof sig1 === 'string' ? sig1 : Array.from(new Uint8Array(sig1 as ArrayBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      log(`SUCCESS sig1: ${sig1Str.slice(0, 80)}...`);

      // Sign same message again to test determinism
      log(`--- signMessage("${testMsg}") attempt 2 ---`);
      const sig2: any = await (wallet as any).signMessage(new TextEncoder().encode(testMsg));
      const sig2Str = typeof sig2 === 'string' ? sig2 : Array.from(new Uint8Array(sig2 as ArrayBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      log(`SUCCESS sig2: ${sig2Str.slice(0, 80)}...`);

      const match = sig1Str === sig2Str;
      log(match ? 'DETERMINISTIC: sig1 === sig2 (safe for salt derivation)' : 'NOT DETERMINISTIC: sig1 !== sig2 (CANNOT use for salt)');
    } catch (err: any) {
      log(`ERROR: ${err?.message || err}`);
      log(`  Full error: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`);
    }
  };

  const dumpWalletObject = () => {
    log('--- wallet object keys ---');
    const keys = Object.keys(wallet);
    log(`Keys: ${keys.join(', ')}`);
    keys.forEach(k => {
      const val = (wallet as any)[k];
      const type = typeof val;
      if (type === 'function') {
        log(`  ${k}: [function]`);
      } else if (type === 'string' || type === 'boolean' || type === 'number') {
        log(`  ${k}: ${val}`);
      } else if (val === null || val === undefined) {
        log(`  ${k}: ${val}`);
      } else {
        log(`  ${k}: [${type}]`);
      }
    });
  };

  return (
    <div className="min-h-screen bg-black text-white p-6 font-mono">
      <h1 className="text-xl font-bold mb-4">Shield Wallet Debug</h1>

      <div className="mb-4 p-3 bg-neutral-900 rounded-lg border border-white/10">
        <p>Address: <span className="text-new-mint">{wallet.address || 'not connected'}</span></p>
        <p>Connected: {wallet.connected ? 'YES' : 'NO'}</p>
        <p>Origin: <span className="text-yellow-400">{typeof window !== 'undefined' ? window.location.origin : 'SSR'}</span></p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={dumpWalletObject} className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">
          Dump Wallet Object
        </button>
        <button onClick={() => testRequestRecords('btc_pred_v10.aleo')} className="px-3 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm">
          requestRecords (v10)
        </button>
        <button onClick={() => testRequestRecords('btc_pred_v9.aleo')} className="px-3 py-2 bg-sky-800 hover:bg-sky-700 rounded-lg text-sm">
          requestRecords (v9)
        </button>
        <button onClick={() => testRequestRecords('test_usdcx_stablecoin.aleo')} className="px-3 py-2 bg-purple-700 hover:bg-purple-600 rounded-lg text-sm">
          requestRecords (USDCx)
        </button>
        <button onClick={() => testRequestRecords('credits.aleo')} className="px-3 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-sm">
          requestRecords (credits)
        </button>
        <button onClick={testTransactionHistory} className="px-3 py-2 bg-amber-700 hover:bg-amber-600 rounded-lg text-sm">
          Transaction History
        </button>
        <button onClick={testSignMessage} className="px-3 py-2 bg-pink-700 hover:bg-pink-600 rounded-lg text-sm">
          Sign Message (x2 determinism test)
        </button>
        <button onClick={testDecrypt} className="px-3 py-2 bg-red-800 hover:bg-red-700 rounded-lg text-sm">
          Test Decrypt
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

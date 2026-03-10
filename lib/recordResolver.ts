/**
 * Record resolver: finds and decrypts BetSlot records.
 *
 * Strategy:
 *  1. Try wallet.requestRecords (fast, but blocked on some origins)
 *  2. Fallback: fetch the bet transaction from the API, extract the
 *     encrypted record output, decrypt via wallet.decrypt()
 */
import { BTC_PREDICTION_PROGRAM, ALEO_API_URL, ALEO_NETWORK } from './predictionContract';

/** Wallet methods we need (subset of useWallet return) */
interface WalletMethods {
  requestRecords?: (program: string) => Promise<any[]>;
  decrypt?: (cipherText: string, tpk?: string, programId?: string, functionName?: string, index?: number) => Promise<string>;
}

/**
 * Try to find an active BetSlot record for the given round.
 * Returns the record plaintext string (ready to pass to executeTransaction), or null.
 */
export async function resolveSlotRecord(
  wallet: WalletMethods,
  roundId?: number,
): Promise<string | null> {
  // ── Strategy 1: requestRecords ──
  if (wallet.requestRecords) {
    try {
      const records = await wallet.requestRecords(BTC_PREDICTION_PROGRAM);
      console.log('[RecordResolver] requestRecords returned:', records?.length, 'records');

      if (records?.length) {
        for (const r of records) {
          const pt = extractPlaintext(r);
          if (!pt) continue;
          const isActive = /active:\s*true/.test(pt) || /"active":\s*true/.test(pt);
          if (isActive) {
            // If a specific round is requested, check rid matches
            if (roundId !== undefined) {
              const ridMatch = pt.match(/rid:\s*(\d+)u64/);
              if (ridMatch && parseInt(ridMatch[1], 10) !== roundId) continue;
            }
            console.log('[RecordResolver] Found active slot via requestRecords');
            return pt;
          }
        }
      }
    } catch (e) {
      console.warn('[RecordResolver] requestRecords failed:', e);
    }
  }

  // ── Strategy 2: Decrypt from stored bet transaction ──
  if (wallet.decrypt) {
    try {
      const txId = getBetTxId(roundId);
      if (!txId) {
        console.log('[RecordResolver] No stored bet tx ID for round', roundId);
        return null;
      }

      console.log('[RecordResolver] Fetching bet tx:', txId);
      const tx = await fetchTransaction(txId);
      if (!tx) return null;

      // Find the bet transition's record output (first record output of bet function)
      const betTransition = tx.execution?.transitions?.find(
        (t: any) => t.program === BTC_PREDICTION_PROGRAM && t.function === 'bet'
      );
      if (!betTransition) {
        console.log('[RecordResolver] No bet transition found in tx');
        return null;
      }

      const recordOutput = betTransition.outputs?.find((o: any) => o.type === 'record');
      if (!recordOutput?.value) {
        console.log('[RecordResolver] No record output in bet transition');
        return null;
      }

      const tpk = betTransition.tpk || undefined;
      console.log('[RecordResolver] Decrypting record via wallet.decrypt...');

      const plaintext = await wallet.decrypt(
        recordOutput.value,
        tpk,
        BTC_PREDICTION_PROGRAM,
        'bet',
        0, // first output
      );
      console.log('[RecordResolver] Decrypted:', plaintext?.slice(0, 200));
      return plaintext || null;
    } catch (e) {
      console.error('[RecordResolver] Tx-based decrypt failed:', e);
    }
  }

  return null;
}

/** Extract plaintext string from various record formats */
function extractPlaintext(record: any): string | null {
  if (typeof record === 'string') return record;
  if (record?.plaintext) return record.plaintext;
  if (record?.data) return typeof record.data === 'string' ? record.data : JSON.stringify(record.data);
  try { return JSON.stringify(record); } catch { return null; }
}

/** Get stored bet tx ID for a round from localStorage */
function getBetTxId(roundId?: number): string | null {
  try {
    const betTxs = JSON.parse(localStorage.getItem('pred_bet_txids') || '{}');
    if (roundId !== undefined) return betTxs[roundId] || null;
    // If no specific round, return the most recent one
    const entries = Object.entries(betTxs);
    return entries.length > 0 ? (entries[entries.length - 1][1] as string) : null;
  } catch {
    return null;
  }
}

/** Fetch a transaction from the Aleo API */
async function fetchTransaction(txId: string): Promise<any | null> {
  try {
    const res = await fetch(`${ALEO_API_URL}/${ALEO_NETWORK}/transaction/${txId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

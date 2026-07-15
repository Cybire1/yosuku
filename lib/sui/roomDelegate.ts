'use client';

// The Room's "messaging delegate".
//
// @mysten/sui-stack-messaging (0.0.2) + our relayer authenticate every request with a
// RAW keypair signature (flag 0x00/0x01/0x02) — a zkLogin/Google wallet returns a
// scheme-flag-0x05 blob, which the relayer + Seal key servers reject server-side
// ("Unknown signature scheme flag: 0x05"). That's why seed-phrase wallets worked and
// Google login never could.
//
// Fix: keep the zkLogin wallet as the LOGIN + position-gate identity, but run all
// messaging (relayer auth, Seal SessionKey, per-message signing) on a per-user Ed25519
// keypair — the exact scheme (flag 0x00) that already works. The delegate is made an
// on-chain room member the same way any bettor is (bet_registry::record → market_room_rule::join,
// both Onara-sponsored), gated client-side by the owner's real bet. Random + persisted per
// zkLogin address (NOT derived from a zkLogin signature, which is non-deterministic).

import { useEffect, useState } from 'react';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const storageKey = (zkAddress: string) => `yosuku.room.delegate.${zkAddress}`;

/** Get (or create + persist) the Ed25519 messaging delegate for a zkLogin address.
 *  Same delegate across reloads → same room membership. Falls back to an ephemeral
 *  keypair if storage is unavailable (private mode) — the user just re-joins. */
export function getRoomDelegate(zkAddress: string): Ed25519Keypair {
  const k = storageKey(zkAddress);
  try {
    const stored = localStorage.getItem(k);
    if (stored) return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(stored).secretKey);
  } catch {
    /* unreadable / private mode → generate ephemeral below */
  }
  const kp = Ed25519Keypair.generate();
  try {
    localStorage.setItem(k, kp.getSecretKey());
  } catch {
    /* best-effort persist; an ephemeral delegate still works for this session */
  }
  return kp;
}

/** React hook: the messaging delegate for the connected zkLogin address (null until known). */
export function useRoomDelegate(zkAddress: string | undefined | null): Ed25519Keypair | null {
  const [kp, setKp] = useState<Ed25519Keypair | null>(null);
  useEffect(() => {
    if (!zkAddress) {
      setKp(null);
      return;
    }
    setKp(getRoomDelegate(zkAddress));
  }, [zkAddress]);
  return kp;
}

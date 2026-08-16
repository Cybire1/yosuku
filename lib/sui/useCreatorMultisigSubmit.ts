'use client';

import { useCallback } from 'react';
import { useSignTransaction } from '@mysten/dapp-kit';
import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { Transaction } from '@mysten/sui/transactions';
import type { Signer } from '@mysten/sui/cryptography';
import { grpc } from './modernClients';
import { getSponsorStatus, submitSponsored } from '@/lib/sponsor';
import { pickSponsorGasPayment } from './useSmartSubmit';

export function useCreatorMultisigSubmit() {
  const { mutateAsync: signTransaction } = useSignTransaction();

  const prepare = useCallback(async (tx: Transaction, controller: MultiSigPublicKey) => {
    const sponsor = await getSponsorStatus();
    if (!sponsor) throw new Error('Creator recovery setup needs the gas sponsor. Try again shortly.');
    tx.setSender(controller.toSuiAddress());
    tx.setGasOwner(sponsor.address);
    const payment = await pickSponsorGasPayment(sponsor.address);
    if (payment) tx.setGasPayment(payment);
    return { sponsor, bytes: await tx.build({ client: grpc }) };
  }, []);

  const submitWithWallet = useCallback(async (tx: Transaction, controller: MultiSigPublicKey) => {
    const { bytes } = await prepare(tx, controller);
    const partial = await signTransaction({ transaction: Transaction.from(bytes) });
    const signature = controller.combinePartialSignatures([partial.signature]);
    const result = await submitSponsored({
      sender: controller.toSuiAddress(),
      txBytes: partial.bytes,
      txSignature: signature,
    });
    await grpc.waitForTransaction({ digest: result.digest });
    return result;
  }, [prepare, signTransaction]);

  const submitWithRecovery = useCallback(async (
    tx: Transaction,
    controller: MultiSigPublicKey,
    recoverySigner: Signer,
  ) => {
    const { bytes } = await prepare(tx, controller);
    const partial = await recoverySigner.signTransaction(bytes);
    const signature = controller.combinePartialSignatures([partial.signature]);
    const result = await submitSponsored({
      sender: controller.toSuiAddress(),
      txBytes: partial.bytes,
      txSignature: signature,
    });
    await grpc.waitForTransaction({ digest: result.digest });
    return result;
  }, [prepare]);

  return { submitWithWallet, submitWithRecovery };
}

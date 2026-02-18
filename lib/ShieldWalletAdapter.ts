import {
  BaseMessageSignerWalletAdapter,
  DecryptPermission,
  WalletAdapterNetwork,
  WalletName,
  WalletReadyState,
  scopePollingDetectionStrategy,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletTransactionError,
  WalletSignMessageError,
  WalletDecryptionError,
  WalletRecordsError,
  AleoTransaction,
  AleoDeployment,
  WalletError,
} from '@demox-labs/aleo-wallet-adapter-base';

interface ShieldWindow extends Window {
  shield?: {
    icon: string;
    eventEmitter: { all: Record<string, unknown> };
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    off: (event: string, cb: (...args: unknown[]) => void) => void;
    emit: (event: string, ...args: unknown[]) => void;
    _publicKey: string;
    _network: string | undefined;
    connect: (
      decryptPermission: string,
      network: string,
      programs?: string[]
    ) => Promise<{ address: string }>;
    disconnect: () => Promise<void>;
    signMessage: (message: Uint8Array) => Promise<{ signature: Uint8Array }>;
    decrypt: (
      cipherText: string,
      tpk?: string,
      programId?: string,
      functionName?: string,
      index?: number
    ) => Promise<{ text: string }>;
    executeTransaction: (transaction: AleoTransaction) => Promise<{ transactionId: string }>;
    transactionStatus: (transactionId: string) => Promise<{ status: string }>;
    switchNetwork: (network: string) => Promise<void>;
    requestRecords: (program: string) => Promise<{ records: unknown[] }>;
    executeDeployment: (deployment: AleoDeployment) => Promise<{ transactionId: string }>;
    transitionViewKeys: (transactionId: string) => Promise<{ viewKeys: string[] }>;
    requestTransactionHistory: (program: string) => Promise<{ transactions: unknown[] }>;
  };
}

declare const window: ShieldWindow;

export const ShieldWalletName = 'Shield Wallet' as WalletName<'Shield Wallet'>;

export class ShieldWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = ShieldWalletName;
  icon =
    'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDI0IiBoZWlnaHQ9IjEwMjQiIGZpbGw9IiMwMDAiLz48dGV4dCB4PSI1MTIiIHk9IjU1MCIgZmlsbD0iI2ZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1zaXplPSIzMjAiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXdlaWdodD0iYm9sZCI+UzwvdGV4dD48L3N2Zz4=';
  url = 'https://aleo.org/shield/';
  readonly supportedTransactionVersions = null;

  private _connecting = false;
  private _publicKey: string | null = null;
  private _readyState: WalletReadyState =
    typeof window === 'undefined' || typeof document === 'undefined'
      ? WalletReadyState.Unsupported
      : WalletReadyState.NotDetected;

  get publicKey() {
    return this._publicKey;
  }

  get connecting() {
    return this._connecting;
  }

  get readyState() {
    return this._readyState;
  }

  constructor() {
    super();

    if (this._readyState !== WalletReadyState.Unsupported) {
      scopePollingDetectionStrategy(() => {
        if (window.shield) {
          this._readyState = WalletReadyState.Installed;
          this.emit('readyStateChange', this._readyState);

          // Listen for account changes
          window.shield.on('accountChange', () => {
            const newKey = window.shield?._publicKey || null;
            if (newKey && this._publicKey && newKey !== this._publicKey) {
              this._publicKey = newKey;
              this.emit('connect', newKey);
            }
          });

          return true;
        }
        return false;
      });
    }
  }

  async connect(
    decryptPermission: DecryptPermission = DecryptPermission.NoDecrypt,
    network: WalletAdapterNetwork = WalletAdapterNetwork.TestnetBeta,
    programs?: string[]
  ): Promise<void> {
    try {
      if (this.connected || this._connecting) return;
      if (this._readyState !== WalletReadyState.Installed)
        throw new WalletNotReadyError();

      this._connecting = true;

      const wallet = window.shield;
      if (!wallet) throw new WalletNotReadyError();

      try {
        const result = await wallet.connect(decryptPermission, network, programs);
        // Shield may return address in result or store it in _publicKey
        const address = result?.address || wallet._publicKey;
        if (!address) throw new WalletConnectionError('No public key returned');
        this._publicKey = address;
      } catch (error: unknown) {
        throw new WalletConnectionError((error as Error)?.message);
      }

      this.emit('connect', this._publicKey!);
    } catch (error: unknown) {
      this.emit('error', error instanceof WalletError ? error : new WalletConnectionError((error as Error)?.message));
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const wallet = window.shield;
    if (wallet) {
      try {
        await wallet.disconnect();
      } catch (error: unknown) {
        this.emit('error', new WalletDisconnectionError((error as Error)?.message));
      }
    }
    this._publicKey = null;
    this.emit('disconnect');
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const wallet = window.shield;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();
      const result = await wallet.signMessage(message);
      return result?.signature ?? result as unknown as Uint8Array;
    } catch (error: unknown) {
      this.emit('error', new WalletSignMessageError((error as Error)?.message));
      throw error;
    }
  }

  async decrypt(
    cipherText: string,
    tpk?: string,
    programId?: string,
    functionName?: string,
    index?: number
  ): Promise<string> {
    try {
      const wallet = window.shield;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();
      const result = await wallet.decrypt(cipherText, tpk, programId, functionName, index);
      return result?.text ?? result as unknown as string;
    } catch (error: unknown) {
      this.emit('error', new WalletDecryptionError((error as Error)?.message));
      throw error;
    }
  }

  async requestRecords(program: string): Promise<unknown[]> {
    try {
      const wallet = window.shield;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();
      const result = await wallet.requestRecords(program);
      return result?.records ?? result as unknown as unknown[];
    } catch (error: unknown) {
      this.emit('error', new WalletRecordsError((error as Error)?.message));
      throw error;
    }
  }

  async requestTransaction(transaction: AleoTransaction): Promise<string> {
    try {
      const wallet = window.shield;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();
      // Shield uses executeTransaction instead of requestTransaction
      const result = await wallet.executeTransaction(transaction);
      return result?.transactionId ?? result as unknown as string;
    } catch (error: unknown) {
      this.emit('error', new WalletTransactionError((error as Error)?.message));
      throw error;
    }
  }

  async requestExecution(transaction: AleoTransaction): Promise<string> {
    // Shield doesn't have a separate requestExecution — use executeTransaction
    return this.requestTransaction(transaction);
  }

  async requestBulkTransactions(transactions: AleoTransaction[]): Promise<string[]> {
    // Execute one at a time
    const results: string[] = [];
    for (const tx of transactions) {
      results.push(await this.requestTransaction(tx));
    }
    return results;
  }

  async requestDeploy(deployment: AleoDeployment): Promise<string> {
    try {
      const wallet = window.shield;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();
      const result = await wallet.executeDeployment(deployment);
      return result?.transactionId ?? result as unknown as string;
    } catch (error: unknown) {
      this.emit('error', new WalletTransactionError((error as Error)?.message));
      throw error;
    }
  }

  async transactionStatus(transactionId: string): Promise<string> {
    try {
      const wallet = window.shield;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();
      const result = await wallet.transactionStatus(transactionId);
      return result?.status ?? result as unknown as string;
    } catch (error: unknown) {
      throw error;
    }
  }

  async transitionViewKeys(transactionId: string): Promise<string[]> {
    try {
      const wallet = window.shield;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();
      const result = await wallet.transitionViewKeys(transactionId);
      return result?.viewKeys ?? result as unknown as string[];
    } catch (error: unknown) {
      throw error;
    }
  }

  async getExecution(transactionId: string): Promise<string> {
    // Shield doesn't have getExecution — fall back to transactionStatus
    return this.transactionStatus(transactionId);
  }

  async requestRecordPlaintexts(program: string): Promise<unknown[]> {
    return this.requestRecords(program);
  }

  async requestTransactionHistory(program: string): Promise<unknown[]> {
    try {
      const wallet = window.shield;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();
      const result = await wallet.requestTransactionHistory(program);
      return result?.transactions ?? result as unknown as unknown[];
    } catch (error: unknown) {
      throw error;
    }
  }
}

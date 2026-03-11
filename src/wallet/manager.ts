import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import type { Page } from '@playwright/test';
import { buildInjectScript } from './inject.js';
import {
  type WalletConfig,
  type SuiNetwork,
  type AccountInfo,
  NETWORK_URLS,
  LOCALNET_FAUCET_URL,
} from './types.js';

/**
 * Node-side wallet manager. Holds the Ed25519 keypair and SuiGrpcClient,
 * exposes bridge functions to Playwright pages, and injects the mock
 * wallet registration script.
 *
 * The private key never leaves Node.js. The browser-side wallet is a
 * thin shell that delegates signing via page.exposeFunction() bridges.
 */
export class WalletManager {
  private keypair: Ed25519Keypair;
  private client: SuiGrpcClient;
  private _address: string;
  private _publicKeyBase64: string;
  private _network: SuiNetwork;
  private _rpcUrl: string;
  private _injectedPages = new Set<Page>();

  constructor(config: WalletConfig = {}) {
    // --- Keypair ---
    if (config.privateKey) {
      // Accept hex (0x-prefixed or raw) or base64
      let keyBytes = config.privateKey.startsWith('0x')
        ? hexToBytes(config.privateKey.slice(2))
        : isBase64(config.privateKey)
          ? fromBase64(config.privateKey)
          : hexToBytes(config.privateKey);
      // Strip Sui keystore scheme flag byte (0x00=Ed25519, 0x01=Secp256k1, 0x02=Secp256r1)
      if (keyBytes.length === 33 && keyBytes[0] <= 0x02) {
        keyBytes = keyBytes.slice(1);
      }
      this.keypair = Ed25519Keypair.fromSecretKey(keyBytes);
    } else if (config.mnemonic) {
      this.keypair = Ed25519Keypair.deriveKeypair(config.mnemonic);
    } else {
      this.keypair = new Ed25519Keypair();
    }

    // --- Network / RPC ---
    this._network = config.network ?? 'localnet';
    this._rpcUrl = config.rpcUrl ?? NETWORK_URLS[this._network];
    this.client = new SuiGrpcClient({
      network: this._network,
      baseUrl: this._rpcUrl,
    });

    // --- Derived info ---
    this._address = this.keypair.getPublicKey().toSuiAddress();
    this._publicKeyBase64 = toBase64(this.keypair.getPublicKey().toRawBytes());
  }

  // ── Public getters ───────────────────────────────────────────────

  get address(): string {
    return this._address;
  }

  get network(): SuiNetwork {
    return this._network;
  }

  get rpcUrl(): string {
    return this._rpcUrl;
  }

  get publicKeyBase64(): string {
    return this._publicKeyBase64;
  }

  get suiClient(): SuiGrpcClient {
    return this.client;
  }

  accountInfo(): AccountInfo {
    return {
      address: this._address,
      publicKey: this._publicKeyBase64,
    };
  }

  // ── Balance & faucet ─────────────────────────────────────────────

  async getBalance(): Promise<bigint> {
    const result = await this.client.getBalance({ owner: this._address });
    return BigInt(result.balance.balance);
  }

  /** Request SUI from the localnet faucet. Only works on localnet. */
  async requestFaucet(): Promise<void> {
    if (this._network !== 'localnet') {
      throw new Error('Faucet is only available on localnet');
    }
    const response = await fetch(LOCALNET_FAUCET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        FixedAmountRequest: { recipient: this._address },
      }),
    });
    if (!response.ok) {
      throw new Error(`Faucet request failed: ${response.status} ${response.statusText}`);
    }
  }

  // ── Page injection ───────────────────────────────────────────────

  /**
   * Inject the mock wallet into a Playwright page.
   *
   * 1. Exposes three bridge functions (sign_tx, sign_and_exec, sign_msg)
   * 2. Adds an init script that registers the mock wallet via Wallet Standard events
   *
   * Call this BEFORE navigating to the dApp. The init script runs before
   * any page JavaScript, ensuring the mock wallet is registered before
   * dApp Kit initializes.
   */
  async inject(page: Page): Promise<void> {
    if (this._injectedPages.has(page)) {
      return; // Already injected
    }

    // 1. Expose bridge functions (persist across navigations)
    await page.exposeFunction(
      '__pw_wallet_sign_tx',
      this.handleSignTx.bind(this),
    );
    await page.exposeFunction(
      '__pw_wallet_sign_and_exec',
      this.handleSignAndExec.bind(this),
    );
    await page.exposeFunction(
      '__pw_wallet_sign_msg',
      this.handleSignMsg.bind(this),
    );

    // 2. Inject wallet registration script (runs before page JS on every navigation)
    const script = buildInjectScript({
      address: this._address,
      publicKey: this._publicKeyBase64,
      chain: this._network,
    });
    await page.addInitScript(script);

    this._injectedPages.add(page);
  }

  /**
   * Inject the mock wallet into a page that has already loaded.
   * Uses page.evaluate() instead of addInitScript().
   * Useful when the page is already open and you want to add the wallet mid-session.
   */
  async injectLate(page: Page): Promise<void> {
    // Expose bridge functions if not already done
    if (!this._injectedPages.has(page)) {
      await page.exposeFunction(
        '__pw_wallet_sign_tx',
        this.handleSignTx.bind(this),
      );
      await page.exposeFunction(
        '__pw_wallet_sign_and_exec',
        this.handleSignAndExec.bind(this),
      );
      await page.exposeFunction(
        '__pw_wallet_sign_msg',
        this.handleSignMsg.bind(this),
      );
    }

    // Evaluate the injection script in the current page context
    const script = buildInjectScript({
      address: this._address,
      publicKey: this._publicKeyBase64,
      chain: this._network,
    });
    await page.evaluate(script);

    this._injectedPages.add(page);
  }

  /** Check whether a page has been injected. */
  isInjected(page: Page): boolean {
    return this._injectedPages.has(page);
  }

  // ── Bridge handlers (called from browser via exposeFunction) ─────

  /**
   * Build a Transaction from either JSON or base64 BCS bytes.
   * dApp Kit v2 sends JSON (from toJSON()), older code may send base64 BCS.
   */
  private async buildTransaction(input: string): Promise<Uint8Array> {
    const isJson = input.trimStart().startsWith('{');
    if (isJson) {
      const tx = Transaction.from(input);
      if (!tx.getData().sender) {
        tx.setSender(this.keypair.getPublicKey().toSuiAddress());
      }
      return await tx.build({ client: this.client });
    }
    return fromBase64(input);
  }

  /**
   * Sign transaction bytes. Called by the browser-side wallet when
   * dApp Kit invokes sui:signTransaction.
   * Returns JSON with { signature, bytes } where bytes is base64 BCS.
   */
  private async handleSignTx(txInput: string): Promise<string> {
    const bytes = await this.buildTransaction(txInput);
    const { signature } = await this.keypair.signTransaction(bytes);
    return JSON.stringify({ signature, bytes: toBase64(bytes) });
  }

  /**
   * Sign and execute transaction. Called by the browser-side wallet
   * when dApp Kit invokes sui:signAndExecuteTransaction.
   * Accepts either JSON (v2 wallet standard) or base64 BCS bytes.
   * Returns the Wallet Standard v2 response format:
   *   { digest, bytes, signature, effects }
   */
  private async handleSignAndExec(txInput: string): Promise<string> {
    const bytes = await this.buildTransaction(txInput);
    const { signature } = await this.keypair.signTransaction(bytes);
    const result = await this.client.executeTransaction({
      transaction: bytes,
      signatures: [signature],
      include: { effects: true },
    });

    // Unwrap discriminated union
    const tx = result.$kind === 'Transaction'
      ? result.Transaction
      : result.FailedTransaction;

    if (!tx) throw new Error('Transaction execution returned no result');
    if (tx.status && !tx.status.success) {
      throw new Error(`Transaction failed: ${JSON.stringify(tx.status.error)}`);
    }

    // Wallet Standard v2 response format
    const walletResponse = {
      digest: tx.digest,
      bytes: toBase64(bytes),
      signature: signature,
      effects: tx.effects?.bcs ? toBase64(tx.effects.bcs) : '',
    };
    return JSON.stringify(walletResponse, bigIntReplacer);
  }

  /**
   * Sign a personal message. Called by the browser-side wallet when
   * dApp Kit invokes sui:signPersonalMessage.
   */
  private async handleSignMsg(msgBytesBase64: string): Promise<string> {
    const bytes = fromBase64(msgBytesBase64);
    const { signature } = await this.keypair.signPersonalMessage(bytes);
    return signature;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function isBase64(str: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(str) && str.length % 4 === 0 && str.length > 0;
}

/** JSON.stringify replacer that converts BigInt to string. */
function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

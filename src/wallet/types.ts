import type { Page } from '@playwright/test';

/** Configuration for creating a WalletManager. */
export interface WalletConfig {
  /** Hex or base64-encoded private key. If omitted (along with mnemonic), a random keypair is generated. */
  privateKey?: string;
  /** BIP-39 mnemonic phrase. If omitted (along with privateKey), a random keypair is generated. */
  mnemonic?: string;
  /** Target Sui network. Defaults to 'localnet'. */
  network?: SuiNetwork;
  /** Custom RPC URL. Overrides the URL derived from `network`. */
  rpcUrl?: string;
}

export type SuiNetwork = 'localnet' | 'devnet' | 'testnet' | 'mainnet';

/** Account information exposed to the browser-side mock wallet. */
export interface AccountInfo {
  address: string;
  /** Base64-encoded public key bytes. */
  publicKey: string;
}

/** Current wallet state returned by the wallet_state MCP tool. */
export interface WalletState {
  address: string;
  network: string;
  balance: string;
  connected: boolean;
}

/** Configuration passed to the browser injection script. */
export interface InjectConfig {
  address: string;
  /** Base64-encoded Ed25519 public key. */
  publicKey: string;
  /** Sui chain identifier (e.g. 'testnet', 'localnet'). */
  chain: string;
}

/** A page that has been injected with the mock wallet. */
export interface InjectedPage {
  page: Page;
  address: string;
  network: string;
}

/** Network-to-RPC-URL mapping. */
export const NETWORK_URLS: Record<SuiNetwork, string> = {
  localnet: 'http://127.0.0.1:9000',
  devnet: 'https://fullnode.devnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
  mainnet: 'https://fullnode.mainnet.sui.io:443',
};

/** Localnet faucet endpoint. */
export const LOCALNET_FAUCET_URL = 'http://127.0.0.1:9123/gas';

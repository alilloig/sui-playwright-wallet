import type { Page } from '@playwright/test';
import { WalletManager } from '../wallet/manager.js';
import type { SuiNetwork, WalletState } from '../wallet/types.js';

/**
 * MCP tool schemas and handlers for the Sui Playwright wallet.
 *
 * Each tool is a pair of { schema, createHandler(getPage, getState, setState) }.
 * The getPage/getState/setState functions let the tools integrate with
 * whatever MCP server manages the Playwright page and server state.
 */

// ── Shared state management ───────────────────────────────────────

export interface WalletMcpState {
  manager: WalletManager | null;
  connected: boolean;
}

export function createInitialState(): WalletMcpState {
  return { manager: null, connected: false };
}

// ── Tool: wallet_setup ────────────────────────────────────────────

export const walletSetupSchema = {
  name: 'wallet_setup',
  description:
    'Set up a mock Sui wallet for testing. Creates a keypair (or uses provided key material), ' +
    'injects the mock wallet into the current browser page, and returns the wallet address. ' +
    'On localnet, automatically funds the wallet via faucet.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      privateKey: {
        type: 'string',
        description: 'Hex or base64-encoded private key. If omitted, a random keypair is generated.',
      },
      mnemonic: {
        type: 'string',
        description: 'BIP-39 mnemonic phrase. If omitted, a random keypair is generated.',
      },
      network: {
        type: 'string',
        enum: ['localnet', 'devnet', 'testnet', 'mainnet'],
        description: 'Target Sui network. Defaults to localnet.',
      },
      rpcUrl: {
        type: 'string',
        description: 'Custom RPC URL. Overrides the URL derived from network.',
      },
    },
  },
} as const;

export interface WalletSetupInput {
  privateKey?: string;
  mnemonic?: string;
  network?: SuiNetwork;
  rpcUrl?: string;
}

export function walletSetupHandler(
  getPage: () => Page,
  state: WalletMcpState,
) {
  return async (input: WalletSetupInput) => {
    const manager = new WalletManager({
      privateKey: input.privateKey,
      mnemonic: input.mnemonic,
      network: input.network,
      rpcUrl: input.rpcUrl,
    });

    const page = getPage();
    await manager.inject(page);
    state.manager = manager;

    // Auto-fund on localnet
    if (manager.network === 'localnet') {
      try {
        await manager.requestFaucet();
      } catch {
        // Faucet may not be available — non-fatal
      }
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            address: manager.address,
            network: manager.network,
            publicKey: manager.publicKeyBase64,
            status: 'ready',
          }),
        },
      ],
    };
  };
}

// ── Tool: wallet_connect ──────────────────────────────────────────

export const walletConnectSchema = {
  name: 'wallet_connect',
  description:
    'Connect the mock wallet to the dApp. Clicks the Connect Wallet button, ' +
    'selects the Playwright Test Wallet, and verifies the connection. ' +
    'Pass custom selectors if your dApp uses non-standard button/modal markup.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      walletName: {
        type: 'string',
        description: 'Name of the wallet to select in the modal. Defaults to "Playwright Test Wallet".',
      },
      connectSelector: {
        type: 'string',
        description:
          'CSS/Playwright selector for the Connect Wallet button. ' +
          'Defaults to \'[data-testid="connect-button"], button:has-text("Connect Wallet"), button:has-text("Connect")\'.',
      },
      walletSelector: {
        type: 'string',
        description:
          'CSS/Playwright selector for the wallet entry inside the modal. ' +
          'Defaults to matching by wallet name text.',
      },
      connectedSelector: {
        type: 'string',
        description:
          'CSS/Playwright selector to wait for after connection succeeds. ' +
          'Defaults to \'[data-testid="account-address"], [data-testid="connected"]\'.',
      },
    },
  },
} as const;

export interface WalletConnectInput {
  walletName?: string;
  connectSelector?: string;
  walletSelector?: string;
  connectedSelector?: string;
}

const DEFAULT_CONNECT_SELECTOR =
  '[data-testid="connect-button"], button:has-text("Connect Wallet"), button:has-text("Connect")';
const DEFAULT_CONNECTED_SELECTOR =
  '[data-testid="account-address"], [data-testid="connected"]';

export function walletConnectHandler(
  getPage: () => Page,
  state: WalletMcpState,
) {
  return async (input: WalletConnectInput) => {
    if (!state.manager) {
      return {
        content: [{ type: 'text' as const, text: 'Error: Call wallet_setup first.' }],
        isError: true,
      };
    }

    const page = getPage();
    const walletName = input.walletName ?? 'Playwright Test Wallet';

    // Click the Connect Wallet button
    const connectBtn = page
      .locator(input.connectSelector ?? DEFAULT_CONNECT_SELECTOR)
      .first();
    await connectBtn.click({ timeout: 5000 });

    // Select the mock wallet from the modal
    const walletOption = page
      .locator(input.walletSelector ?? `text=${walletName}`)
      .first();
    await walletOption.click({ timeout: 5000 });

    // Wait for connection to complete
    await page
      .waitForSelector(input.connectedSelector ?? DEFAULT_CONNECTED_SELECTOR, {
        timeout: 5000,
      })
      .catch(() => {
        // Some dApps don't surface a testable element — non-fatal
      });

    state.connected = true;

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            connected: true,
            address: state.manager.address,
          }),
        },
      ],
    };
  };
}

// ── Tool: wallet_state ────────────────────────────────────────────

export const walletStateSchema = {
  name: 'wallet_state',
  description:
    'Get the current wallet state including address, network, balance, and connection status.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
} as const;

export function walletStateHandler(
  _getPage: () => Page,
  state: WalletMcpState,
) {
  return async () => {
    if (!state.manager) {
      return {
        content: [{ type: 'text' as const, text: 'Error: Call wallet_setup first.' }],
        isError: true,
      };
    }

    let balance = '0';
    try {
      balance = (await state.manager.getBalance()).toString();
    } catch {
      // RPC might be unavailable
    }

    const result: WalletState = {
      address: state.manager.address,
      network: state.manager.network,
      balance,
      connected: state.connected,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  };
}

// ── Tool: wallet_disconnect ───────────────────────────────────────

export const walletDisconnectSchema = {
  name: 'wallet_disconnect',
  description:
    'Disconnect the mock wallet from the dApp and clean up state.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
} as const;

export function walletDisconnectHandler(
  getPage: () => Page,
  state: WalletMcpState,
) {
  return async () => {
    if (!state.manager) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ disconnected: true }) }],
      };
    }

    const page = getPage();

    // Trigger disconnect via the browser-side wallet
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      if (w.__pw_wallet_info) {
        window.dispatchEvent(new CustomEvent('wallet-standard:disconnect'));
      }
    }).catch(() => {});

    // Try clicking a disconnect button if present
    const disconnectBtn = page.locator(
      'button:has-text("Disconnect"), [data-testid="disconnect-button"]',
    ).first();
    await disconnectBtn.click({ timeout: 2000 }).catch(() => {});

    state.manager = null;
    state.connected = false;

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ disconnected: true }) }],
    };
  };
}

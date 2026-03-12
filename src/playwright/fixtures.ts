import { test as base, type Page } from '@playwright/test';
import { WalletManager } from '../wallet/manager.js';
import type { SuiNetwork } from '../wallet/types.js';
import { resolveWalletConfig } from '../wallet/resolve.js';
import { clickConnect, waitForConnected } from './helpers.js';

/**
 * Playwright test fixtures that provide a pre-configured Sui mock wallet.
 *
 * Usage:
 * ```typescript
 * import { test, expect } from 'sui-playwright-wallet/fixtures';
 *
 * test('can connect wallet', async ({ connectedPage, wallet }) => {
 *   // Page already has wallet connected
 *   const address = await connectedPage.textContent('[data-testid="account-address"]');
 *   expect(address).toBe(wallet.address);
 * });
 * ```
 */

export interface WalletFixtureOptions {
  /** Sui network to target. Defaults to 'localnet'. */
  walletNetwork: SuiNetwork;
  /** URL of the dApp to test against. Defaults to 'http://localhost:5173'. */
  dappUrl: string;
  /** Private key for the wallet. If omitted, a random keypair is generated. */
  walletPrivateKey: string | undefined;
}

export interface WalletFixtures {
  /** A WalletManager instance with a fresh keypair. */
  wallet: WalletManager;
  /** A page with the mock wallet injected and connected to the dApp. */
  connectedPage: Page;
}

export const test = base.extend<WalletFixtureOptions & WalletFixtures>({
  // Configurable options with defaults
  walletNetwork: ['localnet', { option: true }],
  dappUrl: ['http://localhost:5173', { option: true }],
  walletPrivateKey: [undefined, { option: true }],

  // Wallet fixture: creates a fresh WalletManager
  wallet: async ({ walletNetwork, walletPrivateKey }, use) => {
    const resolved = await resolveWalletConfig({
      network: walletNetwork,
      privateKey: walletPrivateKey,
    });

    const wallet = new WalletManager(resolved.config);

    // Fund on localnet (check resolved network, not fixture option)
    if (wallet.network === 'localnet') {
      try {
        await wallet.requestFaucet();
      } catch {
        // Faucet may not be running
      }
    }

    await use(wallet);
  },

  // Connected page fixture: injects wallet, navigates, and connects
  connectedPage: async ({ page, wallet, dappUrl }, use) => {
    await wallet.inject(page);
    await page.goto(dappUrl);
    await clickConnect(page);
    await waitForConnected(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';

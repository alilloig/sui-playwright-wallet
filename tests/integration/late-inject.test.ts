import { test as base, expect } from '@playwright/test';
import { WalletManager } from '../../src/wallet/manager.js';

const test = base.extend<{ wallet: WalletManager }>({
  wallet: async ({}, use) => {
    await use(new WalletManager());
  },
});

test('injectLate sets __pw_wallet_injected on an already-loaded page', async ({
  page,
  wallet,
}) => {
  await page.goto('/');

  // Verify wallet is NOT injected before injectLate
  const beforeInject = await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__pw_wallet_injected,
  );
  expect(beforeInject).toBeFalsy();

  // Late-inject the wallet
  await wallet.injectLate(page);

  // Verify wallet IS injected after injectLate
  const afterInject = await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__pw_wallet_injected,
  );
  expect(afterInject).toBe(true);
});

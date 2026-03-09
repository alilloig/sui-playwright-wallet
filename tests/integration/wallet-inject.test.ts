import { test, expect } from '../../src/playwright/fixtures.js';

test('injection sets __pw_wallet_injected flag', async ({ connectedPage }) => {
  const injected = await connectedPage.evaluate(
    () => (window as unknown as Record<string, unknown>).__pw_wallet_injected,
  );
  expect(injected).toBe(true);
});

test('injection sets __pw_wallet_info with correct address and chain', async ({
  connectedPage,
  wallet,
}) => {
  const info = await connectedPage.evaluate(
    () => (window as unknown as Record<string, unknown>).__pw_wallet_info as { address: string; chain: string },
  );
  expect(info).toBeTruthy();
  expect(info.address).toBe(wallet.address);
  expect(info.chain).toBe(`sui:${wallet.network}`);
});

test('wallet name appears in connect modal', async ({ page, wallet }) => {
  await wallet.inject(page);
  await page.goto('/');

  // Click the connect button to open the modal
  const connectBtn = page.locator(
    '[data-testid="connect-button"], button:has-text("Connect Wallet"), button:has-text("Connect")',
  ).first();
  await connectBtn.click({ timeout: 5000 });

  // Verify the Playwright Test Wallet appears in the modal
  const walletOption = page.locator('text=Playwright Test Wallet').first();
  await expect(walletOption).toBeVisible({ timeout: 5000 });
});

test('connected dApp shows account address matching wallet', async ({
  connectedPage,
  wallet,
}) => {
  const addressEl = connectedPage.locator('[data-testid="account-address"]');
  await expect(addressEl).toBeVisible();
  const displayedAddress = await addressEl.textContent();
  expect(displayedAddress).toBe(wallet.address);
});

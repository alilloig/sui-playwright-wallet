import type { Page } from '@playwright/test';

/**
 * Wait until the mock wallet injection is complete.
 * The injection script sets window.__pw_wallet_injected = true.
 */
export async function waitForWalletReady(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__pw_wallet_injected === true,
    { timeout },
  );
}

export interface ClickConnectOptions {
  /** Name of the wallet in the modal. Default: "Playwright Test Wallet" */
  walletName?: string;
  /** Selector for the Connect button. */
  connectSelector?: string;
  /** Selector for the wallet entry inside the modal. */
  walletSelector?: string;
}

const DEFAULT_CONNECT_SELECTOR =
  '[data-testid="connect-button"], button:has-text("Connect Wallet"), button:has-text("Connect")';

/**
 * Click the dApp Kit Connect Wallet button and select the mock wallet.
 *
 * @param page - Playwright page with the dApp loaded
 * @param opts - Optional selector overrides for custom dApp UIs
 */
export async function clickConnect(
  page: Page,
  opts: ClickConnectOptions = {},
): Promise<void> {
  const walletName = opts.walletName ?? 'Playwright Test Wallet';

  const connectBtn = page
    .locator(opts.connectSelector ?? DEFAULT_CONNECT_SELECTOR)
    .first();
  await connectBtn.click({ timeout: 5000 });

  const walletOption = page
    .locator(opts.walletSelector ?? `text=${walletName}`)
    .first();
  await walletOption.click({ timeout: 5000 });
}

/**
 * Wait for the dApp to show a connected account address.
 */
export async function waitForConnected(page: Page, timeout = 5000): Promise<string> {
  const addressEl = await page.waitForSelector(
    '[data-testid="account-address"]',
    { timeout },
  );
  return (await addressEl.textContent()) ?? '';
}

/**
 * Check if the dApp currently shows a connected wallet.
 */
export async function isConnected(page: Page): Promise<boolean> {
  return page.locator('[data-testid="account-address"]').isVisible();
}

/**
 * Click the disconnect button in the dApp.
 */
export async function clickDisconnect(page: Page): Promise<void> {
  const disconnectBtn = page.locator(
    'button:has-text("Disconnect"), [data-testid="disconnect-button"]',
  ).first();
  await disconnectBtn.click({ timeout: 5000 });
}

/**
 * Get wallet info that was stored by the injection script.
 */
export async function getInjectedWalletInfo(
  page: Page,
): Promise<{ address: string; chain: string } | null> {
  return page.evaluate(() => {
    const info = (window as unknown as Record<string, unknown>).__pw_wallet_info;
    if (info && typeof info === 'object') {
      return info as { address: string; chain: string };
    }
    return null;
  });
}

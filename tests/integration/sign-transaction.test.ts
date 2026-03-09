import { test, expect } from '../../src/playwright/fixtures.js';

// Guard: skip entire suite if localnet is unreachable
test.beforeAll(async () => {
  try {
    const response = await fetch('http://127.0.0.1:9000', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'sui_getLatestCheckpointSequenceNumber', id: 1 }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      test.skip();
    }
  } catch {
    test.skip();
  }
});

test('sign and execute transaction shows digest', async ({ connectedPage }) => {
  const signTxBtn = connectedPage.locator('[data-testid="sign-tx-button"]');
  await signTxBtn.click();

  const txResult = connectedPage.locator('[data-testid="tx-result"]');
  await expect(txResult).toBeVisible({ timeout: 15000 });

  const resultText = await txResult.textContent();
  expect(resultText).toBeTruthy();
  const result = JSON.parse(resultText!.replace('Transaction Result:', '').trim());
  expect(result).toHaveProperty('digest');
});

test('sign personal message shows signature', async ({ connectedPage }) => {
  const signMsgBtn = connectedPage.locator('[data-testid="sign-msg-button"]');
  await signMsgBtn.click();

  const msgResult = connectedPage.locator('[data-testid="msg-result"]');
  await expect(msgResult).toBeVisible({ timeout: 15000 });

  const resultText = await msgResult.textContent();
  expect(resultText).toBeTruthy();
  const result = JSON.parse(resultText!.replace('Message Signature:', '').trim());
  expect(result).toHaveProperty('signature');
});

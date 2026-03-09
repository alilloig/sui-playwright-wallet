import { describe, it, expect } from 'vitest';
import { buildInjectScript } from '../../src/wallet/inject.js';

const TEST_CONFIG = {
  address: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  chain: 'localnet',
};

describe('buildInjectScript', () => {
  const script = buildInjectScript(TEST_CONFIG);

  it('returns a valid IIFE shape', () => {
    expect(script).toMatch(/^\(function\(\)\s*\{/);
    expect(script).toMatch(/\}\)\(\);$/);
  });

  it('interpolates config values into the script', () => {
    expect(script).toContain(TEST_CONFIG.address);
    expect(script).toContain(TEST_CONFIG.publicKey);
    expect(script).toContain(`sui:${TEST_CONFIG.chain}`);
  });

  it('contains Wallet Standard feature keys', () => {
    expect(script).toContain('sui:signTransaction');
    expect(script).toContain('sui:signAndExecuteTransaction');
    expect(script).toContain('sui:signPersonalMessage');
  });

  it('contains the wallet name', () => {
    expect(script).toContain('Playwright Test Wallet');
  });

  it('contains Wallet Standard registration events', () => {
    expect(script).toContain('wallet-standard:app-ready');
    expect(script).toContain('wallet-standard:register-wallet');
  });

  it('contains resolveTransactionToBase64 helper', () => {
    expect(script).toContain('resolveTransactionToBase64');
  });

  it('contains bridge function references', () => {
    expect(script).toContain('__pw_wallet_sign_tx');
    expect(script).toContain('__pw_wallet_sign_and_exec');
    expect(script).toContain('__pw_wallet_sign_msg');
  });

  it('contains __pw_wallet_injected flag assignment', () => {
    expect(script).toContain('__pw_wallet_injected');
  });
});

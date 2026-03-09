import { describe, it, expect } from 'vitest';
import { WalletManager } from '../../src/wallet/manager.js';
import { NETWORK_URLS } from '../../src/wallet/types.js';
import { SuiGrpcClient } from '@mysten/sui/grpc';

describe('WalletManager', () => {
  describe('keypair creation', () => {
    it('generates a random keypair with a valid Sui address', () => {
      const wallet = new WalletManager();
      expect(wallet.address).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('creates from hex private key (0x-prefixed)', () => {
      // 32 zero bytes as hex
      const hexKey = '0x' + '00'.repeat(32);
      const wallet = new WalletManager({ privateKey: hexKey });
      expect(wallet.address).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('creates from base64 private key', () => {
      // Use a known base64 key (32 random bytes encoded)
      const knownKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      const wallet = new WalletManager({ privateKey: knownKey });
      expect(wallet.address).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('creates from 33-byte keystore key (strips scheme byte)', () => {
      // 0x00 (Ed25519 scheme) + 32 zero bytes = 33 bytes base64
      const keystoreKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const wallet = new WalletManager({ privateKey: keystoreKey });
      expect(wallet.address).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('creates from mnemonic', () => {
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const wallet = new WalletManager({ mnemonic });
      expect(wallet.address).toMatch(/^0x[0-9a-f]{64}$/);
      // Same mnemonic should produce same address
      const wallet2 = new WalletManager({ mnemonic });
      expect(wallet2.address).toBe(wallet.address);
    });
  });

  describe('network configuration', () => {
    it('defaults to localnet with correct rpcUrl', () => {
      const wallet = new WalletManager();
      expect(wallet.network).toBe('localnet');
      expect(wallet.rpcUrl).toBe('http://127.0.0.1:9000');
    });

    it('uses correct rpcUrl for each network', () => {
      for (const [network, expectedUrl] of Object.entries(NETWORK_URLS)) {
        const wallet = new WalletManager({
          network: network as 'localnet' | 'devnet' | 'testnet' | 'mainnet',
        });
        expect(wallet.rpcUrl).toBe(expectedUrl);
      }
    });

    it('custom rpcUrl overrides network default', () => {
      const customUrl = 'http://custom:9999';
      const wallet = new WalletManager({
        network: 'testnet',
        rpcUrl: customUrl,
      });
      expect(wallet.network).toBe('testnet');
      expect(wallet.rpcUrl).toBe(customUrl);
    });
  });

  describe('public getters', () => {
    it('publicKeyBase64 is valid base64', () => {
      const wallet = new WalletManager();
      expect(wallet.publicKeyBase64).toMatch(/^[A-Za-z0-9+/]+=*$/);
      // Ed25519 public key is 32 bytes → 44 chars base64
      expect(wallet.publicKeyBase64.length).toBe(44);
    });

    it('suiClient returns SuiGrpcClient instance', () => {
      const wallet = new WalletManager();
      expect(wallet.suiClient).toBeInstanceOf(SuiGrpcClient);
    });

    it('accountInfo returns address and publicKey', () => {
      const wallet = new WalletManager();
      const info = wallet.accountInfo();
      expect(info).toEqual({
        address: wallet.address,
        publicKey: wallet.publicKeyBase64,
      });
    });
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveWalletConfig } from '../../src/wallet/resolve.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { toBase64 } from '@mysten/sui/utils';

// Mock fs — hoisted by vitest. Default: all readFile calls throw ENOENT.
// CLI keystore tests override this per-test with vi.mocked().
vi.mock('node:fs/promises');

// Helper: build a Sui keystore entry from a real keypair
// Sui CLI stores keys as base64(scheme_byte + 32-byte secret key)
function createMockKeystoreEntry(keypair: Ed25519Keypair): string {
  const { secretKey } = decodeSuiPrivateKey(keypair.getSecretKey());
  const withScheme = new Uint8Array(33);
  withScheme[0] = 0x00; // Ed25519 scheme flag
  withScheme.set(secretKey, 1);
  return toBase64(withScheme);
}

describe('resolveWalletConfig', () => {
  // Ensure mocks and env stubs are restored after every test globally
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('priority 1: explicit params', () => {
    it('uses explicit privateKey', async () => {
      const hexKey = '0x' + '00'.repeat(32);
      const result = await resolveWalletConfig({ privateKey: hexKey });
      expect(result.config.privateKey).toBe(hexKey);
      expect(result.keySource).toBe('explicit');
      expect(result.message).toContain('explicit');
    });

    it('uses explicit mnemonic', async () => {
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      const result = await resolveWalletConfig({ mnemonic });
      expect(result.config.mnemonic).toBe(mnemonic);
      expect(result.keySource).toBe('explicit');
    });

    it('uses explicit network', async () => {
      const result = await resolveWalletConfig({ network: 'testnet' });
      expect(result.config.network).toBe('testnet');
      expect(result.networkSource).toBe('explicit');
    });

    it('uses explicit rpcUrl', async () => {
      const result = await resolveWalletConfig({
        network: 'testnet',
        rpcUrl: 'http://custom:9999',
      });
      expect(result.config.rpcUrl).toBe('http://custom:9999');
      expect(result.networkSource).toBe('explicit');
    });
  });

  describe('priority 4: random ephemeral fallback', () => {
    it('falls back to no key material when nothing provided', async () => {
      const result = await resolveWalletConfig();
      expect(result.config.privateKey).toBeUndefined();
      expect(result.config.mnemonic).toBeUndefined();
      expect(result.keySource).toBe('random-ephemeral');
      expect(result.networkSource).toBe('default-localnet');
      expect(result.config.network).toBeUndefined();
      expect(result.message).toContain('random');
    });

    it('returns empty config with undefined input', async () => {
      const result = await resolveWalletConfig(undefined);
      expect(result.keySource).toBe('random-ephemeral');
      expect(result.networkSource).toBe('default-localnet');
    });
  });

  describe('priority 2: environment variables', () => {
    it('resolves key from SUI_PRIVATE_KEY', async () => {
      const hexKey = '0x' + 'ab'.repeat(32);
      vi.stubEnv('SUI_PRIVATE_KEY', hexKey);
      const result = await resolveWalletConfig();
      expect(result.config.privateKey).toBe(hexKey);
      expect(result.keySource).toBe('env:SUI_PRIVATE_KEY');
      expect(result.message).toContain('SUI_PRIVATE_KEY');
    });

    it('resolves key from SUI_MNEMONIC', async () => {
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      vi.stubEnv('SUI_MNEMONIC', mnemonic);
      const result = await resolveWalletConfig();
      expect(result.config.mnemonic).toBe(mnemonic);
      expect(result.keySource).toBe('env:SUI_MNEMONIC');
      expect(result.message).toContain('SUI_MNEMONIC');
    });

    it('resolves network from SUI_NETWORK', async () => {
      vi.stubEnv('SUI_NETWORK', 'testnet');
      const result = await resolveWalletConfig();
      expect(result.config.network).toBe('testnet');
      expect(result.networkSource).toBe('env:SUI_NETWORK');
      expect(result.message).toContain('SUI_NETWORK=testnet');
    });

    it('SUI_PRIVATE_KEY takes precedence over SUI_MNEMONIC', async () => {
      const hexKey = '0x' + 'ab'.repeat(32);
      vi.stubEnv('SUI_PRIVATE_KEY', hexKey);
      vi.stubEnv('SUI_MNEMONIC', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
      const result = await resolveWalletConfig();
      expect(result.keySource).toBe('env:SUI_PRIVATE_KEY');
    });

    it('explicit params override env vars', async () => {
      const explicitKey = '0x' + '00'.repeat(32);
      vi.stubEnv('SUI_PRIVATE_KEY', '0x' + 'ff'.repeat(32));
      vi.stubEnv('SUI_NETWORK', 'mainnet');
      const result = await resolveWalletConfig({
        privateKey: explicitKey,
        network: 'devnet',
      });
      expect(result.config.privateKey).toBe(explicitKey);
      expect(result.keySource).toBe('explicit');
      expect(result.config.network).toBe('devnet');
      expect(result.networkSource).toBe('explicit');
    });

    it('ignores invalid SUI_NETWORK value', async () => {
      vi.stubEnv('SUI_NETWORK', 'staging');
      const result = await resolveWalletConfig();
      expect(result.networkSource).toBe('default-localnet');
    });
  });

  describe('priority 3: Sui CLI keystore', () => {
    const mockKeypair = new Ed25519Keypair();
    const mockAddress = mockKeypair.getPublicKey().toSuiAddress();
    const mockKeystoreEntry = createMockKeystoreEntry(mockKeypair);
    const configDir = path.join(os.homedir(), '.sui', 'sui_config');

    it('resolves key from CLI keystore matching active address', async () => {
      const clientYaml = `
keystore:
  File: ${configDir}/sui.keystore
envs:
  - alias: testnet
    rpc: "https://fullnode.testnet.sui.io:443"
    ws: ~
active_env: testnet
active_address: "${mockAddress}"
`;
      const keystore = JSON.stringify([mockKeystoreEntry]);

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const p = filePath.toString();
        if (p.endsWith('client.yaml')) return clientYaml;
        if (p.endsWith('sui.keystore')) return keystore;
        throw new Error(`ENOENT: ${p}`);
      });

      const result = await resolveWalletConfig();
      expect(result.keySource).toBe('sui-cli-keystore');
      expect(result.config.privateKey).toBe(mockKeystoreEntry);
      expect(result.networkSource).toBe('sui-cli-config');
      expect(result.config.network).toBe('testnet');
      expect(result.message).toContain(mockAddress.slice(0, 10));
    });

    it('resolves network and rpcUrl from CLI config', async () => {
      const customRpc = 'https://custom-testnet.example.com:443';
      const clientYaml = `
envs:
  - alias: testnet
    rpc: "${customRpc}"
active_env: testnet
active_address: "${mockAddress}"
`;
      const keystore = JSON.stringify([mockKeystoreEntry]);

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const p = filePath.toString();
        if (p.endsWith('client.yaml')) return clientYaml;
        if (p.endsWith('sui.keystore')) return keystore;
        throw new Error(`ENOENT: ${p}`);
      });

      const result = await resolveWalletConfig();
      expect(result.config.network).toBe('testnet');
      expect(result.config.rpcUrl).toBe(customRpc);
    });

    it('falls through when config dir does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      const result = await resolveWalletConfig();
      expect(result.keySource).toBe('random-ephemeral');
      expect(result.networkSource).toBe('default-localnet');
    });

    it('falls through when keystore is malformed JSON', async () => {
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const p = filePath.toString();
        if (p.endsWith('client.yaml')) return `active_address: "${mockAddress}"\nactive_env: testnet`;
        if (p.endsWith('sui.keystore')) return 'not json';
        throw new Error(`ENOENT: ${p}`);
      });

      const result = await resolveWalletConfig();
      expect(result.keySource).toBe('random-ephemeral');
    });

    it('falls through when active address not found in keystore', async () => {
      const otherKeypair = new Ed25519Keypair();
      const otherEntry = createMockKeystoreEntry(otherKeypair);
      const clientYaml = `active_address: "0x${'ab'.repeat(32)}"\nactive_env: testnet`;
      const keystore = JSON.stringify([otherEntry]);

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const p = filePath.toString();
        if (p.endsWith('client.yaml')) return clientYaml;
        if (p.endsWith('sui.keystore')) return keystore;
        throw new Error(`ENOENT: ${p}`);
      });

      const result = await resolveWalletConfig();
      expect(result.keySource).toBe('random-ephemeral');
      // Network should still resolve from CLI (active_address exists, just not matched)
      expect(result.networkSource).toBe('sui-cli-config');
    });

    it('skips CLI source entirely when active_address is missing', async () => {
      const clientYaml = `active_env: testnet`;
      const keystore = JSON.stringify([mockKeystoreEntry]);

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const p = filePath.toString();
        if (p.endsWith('client.yaml')) return clientYaml;
        if (p.endsWith('sui.keystore')) return keystore;
        throw new Error(`ENOENT: ${p}`);
      });

      const result = await resolveWalletConfig();
      // Per spec: missing active_address → skip CLI source entirely
      expect(result.keySource).toBe('random-ephemeral');
      expect(result.networkSource).toBe('default-localnet');
    });

    it('skips non-Ed25519 keys (scheme byte > 0x00)', async () => {
      // Create a fake Secp256k1 entry (scheme byte 0x01)
      const { secretKey } = decodeSuiPrivateKey(mockKeypair.getSecretKey());
      const withScheme = new Uint8Array(33);
      withScheme[0] = 0x01; // Secp256k1
      withScheme.set(secretKey, 1);
      const secp256k1Entry = toBase64(withScheme);

      const clientYaml = `active_address: "${mockAddress}"\nactive_env: localnet`;
      const keystore = JSON.stringify([secp256k1Entry]);

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const p = filePath.toString();
        if (p.endsWith('client.yaml')) return clientYaml;
        if (p.endsWith('sui.keystore')) return keystore;
        throw new Error(`ENOENT: ${p}`);
      });

      const result = await resolveWalletConfig();
      expect(result.keySource).toBe('random-ephemeral');
    });

    it('ignores unknown active_env alias', async () => {
      const clientYaml = `active_address: "${mockAddress}"\nactive_env: staging`;
      const keystore = JSON.stringify([mockKeystoreEntry]);

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const p = filePath.toString();
        if (p.endsWith('client.yaml')) return clientYaml;
        if (p.endsWith('sui.keystore')) return keystore;
        throw new Error(`ENOENT: ${p}`);
      });

      const result = await resolveWalletConfig();
      // Key resolves but network falls through
      expect(result.keySource).toBe('sui-cli-keystore');
      expect(result.networkSource).toBe('default-localnet');
    });

    it('explicit params override CLI keystore', async () => {
      const explicitKey = '0x' + '00'.repeat(32);
      const clientYaml = `active_address: "${mockAddress}"\nactive_env: testnet`;
      const keystore = JSON.stringify([mockKeystoreEntry]);

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const p = filePath.toString();
        if (p.endsWith('client.yaml')) return clientYaml;
        if (p.endsWith('sui.keystore')) return keystore;
        throw new Error(`ENOENT: ${p}`);
      });

      const result = await resolveWalletConfig({ privateKey: explicitKey, network: 'devnet' });
      expect(result.keySource).toBe('explicit');
      expect(result.networkSource).toBe('explicit');
    });

    it('honors keystore.File path from client.yaml', async () => {
      const customPath = '/custom/path/my.keystore';
      const clientYaml = `
keystore:
  File: ${customPath}
active_address: "${mockAddress}"
active_env: localnet
`;
      const keystore = JSON.stringify([mockKeystoreEntry]);

      const readFileCalls: string[] = [];
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        const p = filePath.toString();
        readFileCalls.push(p);
        if (p.endsWith('client.yaml')) return clientYaml;
        if (p === customPath) return keystore;
        throw new Error(`ENOENT: ${p}`);
      });

      const result = await resolveWalletConfig();
      expect(result.keySource).toBe('sui-cli-keystore');
      expect(readFileCalls).toContain(customPath);
    });
  });

  describe('mixed-source resolution', () => {
    it('resolves key and network independently', async () => {
      const hexKey = '0x' + '00'.repeat(32);
      const result = await resolveWalletConfig({ privateKey: hexKey });
      // Key is explicit, but network should fall through to default
      expect(result.keySource).toBe('explicit');
      expect(result.networkSource).toBe('default-localnet');
    });
  });
});

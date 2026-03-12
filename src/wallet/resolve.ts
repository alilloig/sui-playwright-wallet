import type {
  WalletConfig,
  ResolvedWalletConfig,
  KeySource,
  NetworkSource,
} from './types.js';
import { NETWORK_URLS, type SuiNetwork } from './types.js';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/sui/utils';

const VALID_NETWORKS: readonly string[] = ['localnet', 'devnet', 'testnet', 'mainnet'];

interface SuiCliConfig {
  activeAddress?: string;
  activeEnv?: string;
  keystorePath?: string;
  envRpcUrl?: string;
}

async function readSuiCliConfig(): Promise<SuiCliConfig | null> {
  try {
    const configDir = join(homedir(), '.sui', 'sui_config');
    const clientYamlPath = join(configDir, 'client.yaml');
    const raw = await readFile(clientYamlPath, 'utf-8');
    const parsed = parseYaml(raw);

    const activeAddress: string | undefined = parsed?.active_address;
    const activeEnv: string | undefined = parsed?.active_env;
    const keystorePath: string | undefined =
      parsed?.keystore?.File ?? join(configDir, 'sui.keystore');

    // Find the RPC URL for the active env
    let envRpcUrl: string | undefined;
    if (activeEnv && Array.isArray(parsed?.envs)) {
      const envEntry = parsed.envs.find(
        (e: { alias?: string }) => e.alias === activeEnv,
      );
      if (envEntry?.rpc) {
        envRpcUrl = envEntry.rpc;
      }
    }

    return { activeAddress, activeEnv, keystorePath, envRpcUrl };
  } catch {
    return null;
  }
}

function findKeyForAddress(
  keystoreEntries: string[],
  targetAddress: string,
): string | null {
  for (const entry of keystoreEntries) {
    try {
      const keyBytes = fromBase64(entry);
      // Must be 33 bytes (scheme flag + 32-byte key) with Ed25519 scheme (0x00)
      if (keyBytes.length !== 33 || keyBytes[0] !== 0x00) continue;
      const secretKey = keyBytes.slice(1);
      const keypair = Ed25519Keypair.fromSecretKey(secretKey);
      const address = keypair.getPublicKey().toSuiAddress();
      if (address === targetAddress) return entry;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Resolves wallet configuration by walking a 4-level priority chain:
 * 1. Explicit params (passed directly)
 * 2. Environment variables (SUI_PRIVATE_KEY, SUI_MNEMONIC, SUI_NETWORK)
 * 3. Sui CLI keystore (~/.sui/sui_config/sui.keystore + client.yaml)
 * 4. Random ephemeral fallback (no key, localnet)
 *
 * Key and network resolve independently through the chain.
 */
export async function resolveWalletConfig(
  input?: Partial<WalletConfig>,
): Promise<ResolvedWalletConfig> {
  const config: WalletConfig = {};
  let keySource: KeySource = 'random-ephemeral';
  let networkSource: NetworkSource = 'default-localnet';
  const messageParts: string[] = [];

  // --- Priority 1: Explicit params ---
  if (input?.privateKey) {
    config.privateKey = input.privateKey;
    keySource = 'explicit';
    messageParts.push('Key: explicit privateKey param');
  } else if (input?.mnemonic) {
    config.mnemonic = input.mnemonic;
    keySource = 'explicit';
    messageParts.push('Key: explicit mnemonic param');
  }

  if (input?.network) {
    config.network = input.network;
    networkSource = 'explicit';
    if (input.rpcUrl) {
      config.rpcUrl = input.rpcUrl;
    }
    messageParts.push(`Network: explicit ${input.network}${input.rpcUrl ? ` (custom RPC: ${input.rpcUrl})` : ''}`);
  } else if (input?.rpcUrl) {
    config.rpcUrl = input.rpcUrl;
    networkSource = 'explicit';
    messageParts.push(`Network: explicit custom RPC ${input.rpcUrl}`);
  }

  // --- Priority 2: Environment variables ---
  if (keySource === 'random-ephemeral') {
    const envKey = process.env.SUI_PRIVATE_KEY;
    const envMnemonic = process.env.SUI_MNEMONIC;
    if (envKey) {
      config.privateKey = envKey;
      keySource = 'env:SUI_PRIVATE_KEY';
      messageParts.push('Key: env SUI_PRIVATE_KEY');
    } else if (envMnemonic) {
      config.mnemonic = envMnemonic;
      keySource = 'env:SUI_MNEMONIC';
      messageParts.push('Key: env SUI_MNEMONIC');
    }
  }

  if (networkSource === 'default-localnet') {
    const envNetwork = process.env.SUI_NETWORK;
    if (envNetwork && VALID_NETWORKS.includes(envNetwork)) {
      config.network = envNetwork as SuiNetwork;
      config.rpcUrl = NETWORK_URLS[config.network];
      networkSource = 'env:SUI_NETWORK';
      messageParts.push(`Network: env SUI_NETWORK=${envNetwork}`);
    }
  }

  // --- Priority 3: Sui CLI keystore ---
  // Per spec: if active_address is missing from client.yaml, skip CLI source entirely
  if (keySource === 'random-ephemeral' || networkSource === 'default-localnet') {
    const cliConfig = await readSuiCliConfig();
    if (cliConfig && cliConfig.activeAddress) {
      // Resolve network from CLI
      if (networkSource === 'default-localnet' && cliConfig.activeEnv) {
        if (VALID_NETWORKS.includes(cliConfig.activeEnv)) {
          config.network = cliConfig.activeEnv as SuiNetwork;
          config.rpcUrl = cliConfig.envRpcUrl ?? NETWORK_URLS[config.network];
          networkSource = 'sui-cli-config';
          messageParts.push(
            `Network: Sui CLI active env ${cliConfig.activeEnv}` +
              (cliConfig.envRpcUrl ? ` (RPC: ${cliConfig.envRpcUrl})` : ''),
          );
        }
      }

      // Resolve key from CLI
      if (keySource === 'random-ephemeral' && cliConfig.activeAddress && cliConfig.keystorePath) {
        try {
          const keystoreRaw = await readFile(cliConfig.keystorePath, 'utf-8');
          const keystoreEntries: string[] = JSON.parse(keystoreRaw);
          const matchedKey = findKeyForAddress(keystoreEntries, cliConfig.activeAddress);
          if (matchedKey) {
            config.privateKey = matchedKey;
            keySource = 'sui-cli-keystore';
            messageParts.push(
              `Key: Sui CLI keystore (${cliConfig.keystorePath}), active address ${cliConfig.activeAddress.slice(0, 10)}...`,
            );
          }
        } catch {
          // Keystore unreadable or malformed — fall through to next source
        }
      }
    }
  }

  // --- Priority 4: Fallback ---
  if (keySource === 'random-ephemeral') {
    messageParts.push('Key: random ephemeral keypair (no key material provided)');
  }
  if (networkSource === 'default-localnet') {
    messageParts.push('Network: default localnet');
  }

  return {
    config,
    keySource,
    networkSource,
    message: messageParts.join('; '),
  };
}

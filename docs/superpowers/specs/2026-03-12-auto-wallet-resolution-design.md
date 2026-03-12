# Auto Wallet Resolution — Design Spec

**Date**: 2026-03-12
**Status**: Draft
**Scope**: Eliminate manual wallet setup for MCP agent operators by auto-discovering key material and network from the Sui CLI keystore, environment variables, or explicit parameters.

---

## Problem

Every entry path into `sui-playwright-wallet` — MCP `wallet_setup` tool, Playwright fixtures, direct `WalletManager` construction — requires the user to explicitly provide key material or accept a random ephemeral keypair. For MCP agent operators, this means the human must find and paste a private key before the AI agent can set up a wallet. On non-localnet networks, random keypairs are useless (no funds, unknown address).

The Sui CLI (`~/.sui/sui_config/`) already stores keypairs and network configuration that most users have set up. The wallet manager already handles the Sui keystore byte format (scheme flag stripping). The gap is that nothing reads these files automatically.

## Decision Record

| Question | Decision |
|----------|----------|
| Primary persona | MCP agent operator |
| Auto-discovery source | Sui CLI keystore (`sui.keystore` + `client.yaml`) |
| Multiple keys in keystore | Use the `active_address` from `client.yaml` |
| Network resolution | Resolve both key AND network from CLI config |
| Env var set | Minimal: `SUI_PRIVATE_KEY`, `SUI_MNEMONIC`, `SUI_NETWORK` |
| Provenance reporting | `source` field + human-readable `message` in response |
| Architecture | Standalone resolver module (`src/wallet/resolve.ts`) |
| YAML parsing | `yaml` npm package (runtime dependency) |
| CLI RPC URL passthrough | Yes — honor the user's `client.yaml` RPC URLs |
| Caching | No — always read fresh from filesystem |

---

## Resolution Chain

Key and network resolve **independently** through a 4-level priority chain. The resolver stops at the first match per dimension.

| Priority | Source | Key Material | Network | When Used |
|----------|--------|-------------|---------|-----------|
| 1 | Explicit params | `privateKey` or `mnemonic` | `network`, `rpcUrl` | Always checked first |
| 2 | Environment variables | `SUI_PRIVATE_KEY` or `SUI_MNEMONIC` | `SUI_NETWORK` | CI, Docker, shell profiles |
| 3 | Sui CLI keystore | Active address key from `sui.keystore` | Active env from `client.yaml` | Local dev with Sui CLI installed |
| 4 | Random ephemeral | `new Ed25519Keypair()` | `'localnet'` | Fallback (same as today) |

Mixed-source resolution is supported. Example: explicit `network: 'devnet'` + no key → env key → CLI key → random key, all paired with the explicit devnet network.

### `rpcUrl` Derivation

`rpcUrl` is **derived from** the network source, not resolved independently. Each priority level determines its own `rpcUrl`:

| Priority | How `rpcUrl` is determined |
|----------|---------------------------|
| 1 (explicit) | If `rpcUrl` is explicitly passed, it wins unconditionally. If only `network` is passed (no `rpcUrl`), uses `NETWORK_URLS[network]`. |
| 2 (env) | `SUI_NETWORK` sets `network`; `rpcUrl` resolves to `NETWORK_URLS[SUI_NETWORK]`. There is no env var for custom RPC. |
| 3 (CLI) | Both `network` and `rpcUrl` come from `client.yaml` together — `active_env` alias determines the network, and the corresponding `envs[].rpc` provides the URL. |
| 4 (fallback) | `network: 'localnet'`, `rpcUrl: NETWORK_URLS['localnet']` (`http://127.0.0.1:9000`). |

**Mixed-source rule**: The CLI's custom RPC URL is only used when the CLI is also the source for the network. Example: explicit `network: 'testnet'` + no `rpcUrl` + CLI has custom testnet RPC → uses `NETWORK_URLS['testnet']` (the standard URL), NOT the CLI's custom URL.

---

## Data Model

### Core Types

```typescript
type KeySource =
  | 'explicit'
  | 'env:SUI_PRIVATE_KEY'
  | 'env:SUI_MNEMONIC'
  | 'sui-cli-keystore'
  | 'random-ephemeral';

type NetworkSource =
  | 'explicit'
  | 'env:SUI_NETWORK'
  | 'sui-cli-config'
  | 'default-localnet';

interface ResolvedWalletConfig {
  /** Fully resolved config, ready to pass to WalletManager constructor. */
  config: WalletConfig;
  /** Where the key material came from. */
  keySource: KeySource;
  /** Where the network was determined from. */
  networkSource: NetworkSource;
  /** Human-readable summary for MCP responses and debugging. */
  message: string;
}
```

### Function Signature

```typescript
async function resolveWalletConfig(
  input?: Partial<WalletConfig>
): Promise<ResolvedWalletConfig>
```

No extra options or flags. The function always walks the full chain, stopping at the first match per dimension. The input is the same `WalletConfig` the caller would pass to `WalletManager` today.

---

## Sui CLI Keystore Reader

### Files

| File | Default Path | Format | Extracted Data |
|------|-------------|--------|----------------|
| `sui.keystore` | `~/.sui/sui_config/sui.keystore` | JSON array of base64 strings | Private keys (with scheme flag byte prefix) |
| `client.yaml` | `~/.sui/sui_config/client.yaml` | YAML | `active_address`, `active_env`, env aliases with RPC URLs, `keystore.File` path |

### `client.yaml` Structure

```yaml
keystore:
  File: /Users/someone/.sui/sui_config/sui.keystore
envs:
  - alias: localnet
    rpc: "http://127.0.0.1:9000"
    ws: ~
  - alias: testnet
    rpc: "https://fullnode.testnet.sui.io:443"
    ws: ~
active_env: testnet
active_address: "0xabc123..."
```

### Active Address Matching

The keystore is a flat array with no address labels. To find the active address's key:

1. Read `client.yaml` to get `active_address` and (optionally) the `keystore.File` path
2. Read `sui.keystore` (from `keystore.File` path if available, else default path)
3. For each base64 key: decode, strip scheme flag byte if present, derive Ed25519 public key, compute Sui address
4. Return the key whose derived address matches `active_address`

Only Ed25519 keys (scheme byte `0x00`) are candidates. Secp256k1 (`0x01`) and Secp256r1 (`0x02`) keys are skipped because `WalletManager` only supports Ed25519.

**Implementation note**: The resolver uses `fromBase64` (from `@mysten/sui/utils`) to decode keystore entries and `Ed25519Keypair.fromSecretKey` + `getPublicKey().toSuiAddress()` for address derivation. It does NOT need the `hexToBytes`/`isBase64` helpers from `manager.ts` because keystore entries are always base64. The resolver returns the original base64 keystore entry as `config.privateKey` — the `WalletManager` constructor's existing format detection handles the rest.

### Network Mapping

Map `active_env` alias to the `SuiNetwork` union type (`localnet | devnet | testnet | mainnet`). If the alias matches, extract the corresponding `rpc` URL from `envs[]` and set both `network` and `rpcUrl` in the resolved config. If the alias doesn't match any known network, fall through to the next resolution level for network only.

### Failure Modes

All failures are **non-fatal**. The resolver catches, logs to stderr, and falls through.

| Failure | Behavior |
|---------|----------|
| `~/.sui/sui_config/` doesn't exist | Skip CLI source |
| `sui.keystore` is malformed JSON | Skip CLI source |
| `client.yaml` has no `active_address` | Skip CLI source |
| Active address not found in keystore | Skip CLI key (may still resolve CLI network) |
| Active address uses non-Ed25519 scheme | Skip CLI key, message explains why |
| Active env alias not in `SuiNetwork` union | Skip CLI network |
| File permission errors | Skip CLI source |

Each fallthrough emits a stderr log line:
```
[sui-playwright-wallet] Could not read Sui CLI keystore: <reason> — falling back to next source
```

---

## Integration Points

### MCP Standalone Server (`src/mcp/server.ts`)

The `wallet_setup` handler calls `resolveWalletConfig()` with the tool params, then constructs `WalletManager` from the resolved config. The response gains two new fields:

```typescript
{
  address: '0x...',
  network: 'testnet',
  publicKey: '...',
  dappUrl: '...',
  status: 'ready',
  source: 'sui-cli-keystore',
  message: 'Resolved key from Sui CLI keystore (~/.sui/sui_config/sui.keystore), active address 0xabc1…ef23, network: testnet (from client.yaml active env)'
}
```

No input schema changes. All existing params remain optional.

### Composable MCP Tools (`src/mcp/tools.ts`)

**Important**: `src/mcp/tools.ts` has its own independent `walletSetupHandler` implementation — it does NOT call through to `server.ts`. Both files construct `WalletManager` directly and must each be updated independently to call `resolveWalletConfig()`. The `walletSetupHandler` factory in `tools.ts` adds `source`/`message` to its response in the same way as `server.ts`.

### Playwright Fixtures (`src/playwright/fixtures.ts`)

The `wallet` fixture calls `resolveWalletConfig()` before constructing `WalletManager`. A user who sets no `walletPrivateKey` and targets testnet automatically gets their Sui CLI active key.

**Note on mnemonics**: The fixture's `WalletFixtureOptions` exposes `walletPrivateKey` but not a `walletMnemonic` option. This is intentional — no new fixture option is added. Mnemonic-based resolution in the fixture path works via the `SUI_MNEMONIC` environment variable (priority 2). Users who need mnemonic support in Playwright tests should either set `SUI_MNEMONIC` in their environment or use the direct `resolveWalletConfig()` API with a custom fixture.

### Direct API

The `WalletManager` constructor is **unchanged**. Users who want resolution call `resolveWalletConfig()` themselves:

```typescript
import { resolveWalletConfig, WalletManager } from 'sui-playwright-wallet';

const { config, message } = await resolveWalletConfig();
console.log(message);
const wallet = new WalletManager(config);
```

### Public Exports

`resolveWalletConfig`, `ResolvedWalletConfig`, `KeySource`, and `NetworkSource` are exported from the root `"."` entry point via `src/index.ts`.

---

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/wallet/resolve.ts` | Resolution chain, CLI keystore reader, env var reader |
| `tests/unit/resolve.test.ts` | Unit tests for all resolution paths |

### Modified Files

| File | Change |
|------|--------|
| `src/wallet/types.ts` | Add `ResolvedWalletConfig`, `KeySource`, `NetworkSource` types (canonical location for all shared types; `resolve.ts` imports them from here) |
| `src/index.ts` | Export `resolveWalletConfig` from `./wallet/resolve.js` + new types from `./wallet/types.js` |
| `src/mcp/server.ts` | `wallet_setup` handler calls resolver, adds `source`/`message` to response |
| `src/mcp/tools.ts` | `walletSetupHandler` calls resolver, adds `source`/`message` to response |
| `src/playwright/fixtures.ts` | `wallet` fixture calls resolver before constructing `WalletManager` |
| `package.json` | Add `yaml` runtime dependency |
| `tsup.config.ts` | Add `yaml` to `noExternal` in MCP server build |

---

## Testing Strategy

### Unit Tests (`tests/unit/resolve.test.ts`)

| Test Case | Verifies |
|-----------|----------|
| Explicit `privateKey` wins over env + CLI | Priority 1 |
| Explicit `mnemonic` wins over env + CLI | Priority 1 |
| `SUI_PRIVATE_KEY` env var resolves key | Priority 2 |
| `SUI_MNEMONIC` env var resolves key | Priority 2 |
| `SUI_NETWORK` env var resolves network | Priority 2 |
| CLI keystore read with mock filesystem | Priority 3 |
| Active address matched correctly across keystore | Address derivation |
| Active address not found → falls through to random | Graceful degradation |
| Malformed `sui.keystore` → falls through | Error handling |
| Missing `client.yaml` → falls through | Error handling |
| Non-Ed25519 active key → falls through with explanation | Scheme check |
| No env, no CLI → random ephemeral + `'localnet'` | Priority 4 |
| `message` field includes address/network/source | Provenance |
| Key + network resolve independently | Mixed-source |
| Custom `keystore.File` path honored from `client.yaml` | Path override |

Tests use `vi.mock('node:fs/promises')` for filesystem and `vi.stubEnv` for environment variables. No real `~/.sui/` access.

### Integration Tests

Existing integration tests are unaffected. CI has no `~/.sui/` directory, so the resolver falls through to random ephemeral — identical to current behavior.

---

## Backward Compatibility

**Zero breaking changes.**

- `WalletManager` constructor signature unchanged
- `WalletConfig` type unchanged (only new types added)
- `wallet_setup` input schema unchanged
- `wallet_setup` response adds `source` and `message` — additive, non-breaking
- Fixture options unchanged
- Behavior identical when explicit params are provided (priority 1 always wins)

**Observable behavior change**: A user who previously got a random ephemeral key (no params) and has `~/.sui/sui_config/` will now get their CLI key instead. This is the intended improvement. Document in release notes.

---

## Build Impact

The `yaml` package is added as a runtime dependency in `package.json`. In the tsup config:
- **Library build** (build 1 in `tsup.config.ts`): No change. `yaml` is not in the `external` list, but tsup ESM builds externalize all `node_modules` by default. `yaml` remains a runtime dependency that consumers must install (it's already in `dependencies`, not `peerDependencies`).
- **MCP server build** (build 2 in `tsup.config.ts`): Add `/yaml/` to the existing `noExternal` regex array (alongside `/@modelcontextprotocol/`, `/@mysten/`, `/zod/`). This bundles `yaml` into the standalone executable so it works with zero peer deps beyond `playwright`.

---

## Security

| Risk | Mitigation |
|------|------------|
| CLI keystore contains mainnet keys | The resolver reads keys the user already entrusted to their filesystem. Same access as `sui client`. No new attack surface. `source` + `message` make it transparent. |
| Private key in MCP response | Never. Only address (public) and source label appear in responses. Key passes through `config.privateKey` only. |
| `SUI_PRIVATE_KEY` visible in process listings | Standard env var risk. Document that `.mcp.json` `env` block is preferred (process-scoped). |
| Resolver runs in CI where `~/.sui/` is unexpected | CI typically has no `~/.sui/`, so CLI step is a no-op. Env vars are the idiomatic CI path. |

---

## Open Questions (resolved)

1. **`yaml` as runtime dep?** Yes — ~60KB, always available, MCP server bundles it anyway.
2. **Cache CLI keystore reads?** No — always read fresh. User may change active address between calls.
3. **RPC URL from `client.yaml`?** Yes — honor the user's configured RPC URLs, passed through as `rpcUrl`.

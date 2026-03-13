# sui-playwright-wallet

[![npm version](https://img.shields.io/npm/v/sui-playwright-wallet)](https://www.npmjs.com/package/sui-playwright-wallet)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Mock Sui wallet for Playwright-based dApp testing. Injects a [Wallet Standard](https://github.com/wallet-standard/wallet-standard)-compliant wallet into the browser with all cryptographic signing delegated to Node.js — no browser extensions, no manual approvals, no popups.

Works as an **MCP server for AI coding agents** (Claude Code, etc.) and as a **Playwright test library** for automated E2E tests.

> **Requires dApp Kit v2** (`@mysten/dapp-kit-react`). dApp Kit v1 (`@mysten/dapp-kit`) is not supported.

## TL;DR

The fastest way to start: add the MCP server to your project and let Claude test your dApp.

**1. Install**

```bash
npm install sui-playwright-wallet
```

**2. Add to `.mcp.json`**

```json
{
  "mcpServers": {
    "sui-wallet": {
      "command": "npx",
      "args": ["sui-wallet-mcp"],
      "env": {
        "DAPP_URL": "http://localhost:5173",
        "HEADLESS": "true"
      }
    }
  }
}
```

**3. Use the tools** (19 total: 15 browser + 4 wallet)

```
wallet_setup   → creates keypair, injects wallet, auto-funds on localnet
wallet_connect → clicks Connect, selects mock wallet, verifies connection
browser_*      → interact with your dApp (click, type, screenshot, etc.)
wallet_state   → check address, network, balance, connection status
```

If you have `sui client` configured, `wallet_setup` automatically picks up your active address and network. No config needed.

> Writing Playwright tests instead? Jump to [Playwright Test Fixtures](#playwright-test-fixtures).

---

## Installation

```bash
npm install sui-playwright-wallet
```

**Peer dependencies** (install what you need):

```bash
# For Playwright test fixtures
npm install -D @playwright/test

# For composing wallet tools into your own MCP server
npm install @modelcontextprotocol/sdk
```

**Browser binary** (if not already installed):

```bash
npx playwright install chromium
```

**Local Sui node** (optional — only needed for on-chain transaction tests):

```bash
sui start --with-faucet
```

---

## Usage

### MCP Server for Claude Code (Recommended)

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "sui-wallet": {
      "command": "npx",
      "args": ["sui-wallet-mcp"],
      "env": {
        "DAPP_URL": "http://localhost:5173",
        "HEADLESS": "true"
      }
    }
  }
}
```

Or copy the minimal template that ships with the package and fill in your `DAPP_URL`:

```bash
cp node_modules/sui-playwright-wallet/mcp.json .mcp.json
```

After restarting Claude Code (or running `/mcp`), you get 19 tools. A typical flow:

```
1. wallet_setup({ network: "localnet" })
   → generates keypair, launches browser, injects wallet, funds via faucet

2. wallet_connect({})
   → clicks Connect Wallet button, selects "Playwright Test Wallet"

3. browser_click({ selector: "[data-testid='sign-tx-button']" })
   → triggers transaction signing (handled automatically by the mock wallet)

4. browser_snapshot({})
   → read the page to check results

5. wallet_state({})
   → { address, network, balance, connected }
```

Set `HEADLESS=false` to open a visible browser window for debugging.

> **Important:** The MCP server owns its own Playwright browser. Do **not** use it alongside `@playwright/mcp` or any other browser-controlling MCP plugin — they would create separate browser instances and the wallet bridge would only work in this server's browser.

### Playwright Test Fixtures

For automated E2E test suites, import the extended fixtures:

```typescript
import { test, expect } from 'sui-playwright-wallet/fixtures';

test('wallet connects and shows address', async ({ connectedPage, wallet }) => {
  // connectedPage already has:
  //   1. A wallet injected (random keypair, or from env/CLI)
  //   2. Navigated to http://localhost:5173
  //   3. Clicked Connect and selected the mock wallet

  const address = await connectedPage.textContent('[data-testid="account-address"]');
  expect(address).toBe(wallet.address);
});

test('can sign a transaction', async ({ connectedPage }) => {
  await connectedPage.click('[data-testid="sign-tx-button"]');
  await connectedPage.waitForSelector('[data-testid="tx-result"]');
  const result = await connectedPage.textContent('[data-testid="tx-result"]');
  expect(result).toContain('digest');
});
```

The fixtures provide:

- **`wallet`** — a `WalletManager` with a fresh keypair (auto-funded on localnet)
- **`connectedPage`** — a Playwright `Page` with the wallet injected, navigated, and connected

Override defaults in your test file or `playwright.config.ts`:

```typescript
test.use({
  walletNetwork: 'testnet',
  dappUrl: 'http://localhost:3000',
  walletPrivateKey: '0xYOUR_HEX_KEY',
});
```

### Manual WalletManager API

For full control over wallet creation, injection timing, and network selection:

```typescript
import { WalletManager, clickConnect, waitForConnected } from 'sui-playwright-wallet';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

const wallet = new WalletManager({
  network: 'testnet',
  privateKey: '0xYOUR_HEX_PRIVATE_KEY',
});

// IMPORTANT: inject BEFORE navigating — the init script must run before dApp Kit loads
await wallet.inject(page);

await page.goto('http://localhost:5173');

await clickConnect(page);
const address = await waitForConnected(page);
console.log('Connected:', address); // 0x...

await browser.close();
```

For pages that are already loaded, use `injectLate()` instead:

```typescript
await wallet.injectLate(page); // uses page.evaluate() instead of addInitScript()
```

### Composing with Your Own MCP Server

Add the 4 wallet tools to an existing MCP server:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWalletTools } from 'sui-playwright-wallet/mcp';

const server = new McpServer({ name: 'my-server', version: '1.0.0' });

// Simple: just pass a getPage callback
registerWalletTools(server, () => currentPage);

// Or with options: auto-navigate to dApp after wallet injection
registerWalletTools(server, {
  getPage: () => currentPage,
  dappUrl: 'http://localhost:5173',
  defaultNetwork: 'localnet',
});
```

`getPage` must return the same `Page` instance that the user navigates — the wallet bridge functions are bound to a specific page via `exposeFunction()`.

---

## Auto-Resolution: Zero-Config Wallet Setup

Both the MCP server and Playwright fixtures use `resolveWalletConfig()`, which walks a 4-level priority chain to find wallet credentials. Key and network resolve **independently** — you can mix sources.

| Priority | Key Source | Network Source |
|----------|-----------|----------------|
| 1. Explicit params | `privateKey` or `mnemonic` argument | `network` argument |
| 2. Environment variables | `SUI_PRIVATE_KEY` or `SUI_MNEMONIC` | `SUI_NETWORK` |
| 3. Sui CLI config | Active address from `~/.sui/sui_config/sui.keystore` | Active env from `~/.sui/sui_config/client.yaml` |
| 4. Fallback | Random ephemeral Ed25519 keypair | `localnet` |

This means:

- **No config at all?** You get a random wallet on localnet. Good for quick tests.
- **Have `sui client` set up?** Your active address and network are used automatically.
- **CI/CD?** Set `SUI_PRIVATE_KEY` and `SUI_NETWORK` env vars.
- **Explicit?** Pass params directly and they always win.

> **Ed25519 only.** CLI keystore resolution skips Secp256k1 and Secp256r1 keys. If your active CLI address uses a non-Ed25519 key, resolution falls through to the next level.

---

## Configuration Reference

### Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `SUI_PRIVATE_KEY` | Auto-resolution | Hex (`0x...`) or base64 Ed25519 private key |
| `SUI_MNEMONIC` | Auto-resolution | BIP-39 mnemonic phrase |
| `SUI_NETWORK` | Auto-resolution | `localnet`, `devnet`, `testnet`, or `mainnet` |
| `DAPP_URL` | MCP server | Fallback URL for `wallet_setup` auto-navigation |
| `HEADLESS` | MCP server | `true` (default) or `false` to show browser window |

### MCP Server Config (`.mcp.json`)

All available env vars (only `DAPP_URL` is typically needed):

```json
{
  "mcpServers": {
    "sui-wallet": {
      "command": "npx",
      "args": ["sui-wallet-mcp"],
      "env": {
        "DAPP_URL": "http://localhost:5173",
        "HEADLESS": "true",
        "SUI_NETWORK": "localnet",
        "SUI_PRIVATE_KEY": ""
      }
    }
  }
}
```

### Playwright Fixture Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `walletNetwork` | `SuiNetwork` | `'localnet'` | Target Sui network |
| `dappUrl` | `string` | `'http://localhost:5173'` | URL of the dApp under test |
| `walletPrivateKey` | `string \| undefined` | `undefined` | Explicit private key (skips auto-resolution for key) |

### WalletManager Constructor

```typescript
new WalletManager(config?: {
  privateKey?: string;   // hex (0x...) or base64 Ed25519 key
  mnemonic?: string;     // BIP-39 mnemonic
  network?: SuiNetwork;  // 'localnet' | 'devnet' | 'testnet' | 'mainnet' (default: 'localnet')
  rpcUrl?: string;       // custom RPC URL (overrides network default)
})
```

### Network Defaults

| Network | RPC URL | Faucet |
|---------|---------|--------|
| `localnet` | `http://127.0.0.1:9000` | `http://127.0.0.1:9123/gas` (auto-funded) |
| `devnet` | `https://fullnode.devnet.sui.io:443` | — |
| `testnet` | `https://fullnode.testnet.sui.io:443` | — |
| `mainnet` | `https://fullnode.mainnet.sui.io:443` | — |

---

## Caveats & Sharp Edges

### The MCP server owns the browser

The standalone MCP server (`sui-wallet-mcp`) creates and manages its own Playwright browser. The wallet bridge functions are bound to that browser's page via `page.exposeFunction()`. **Do not** run it alongside `@playwright/mcp` or any other browser-controlling MCP plugin — they would create separate browser instances and the wallet would only work in this server's browser.

### Injection timing matters

Call `wallet.inject(page)` **before** `page.goto()`. The injection uses `addInitScript()`, which must register the wallet before dApp Kit initializes. If the page is already loaded, use `wallet.injectLate(page)` instead (it uses `page.evaluate()`).

The MCP server handles this automatically — `wallet_setup` injects before navigating to `dappUrl`.

### Wallet name is hardcoded

The mock wallet registers as `"Playwright Test Wallet"`. If you pass a custom `walletName` to `wallet_connect` or `clickConnect`, it must match this exact string.

### Auto-funding is localnet only

On `localnet`, the wallet is automatically funded via the faucet at `http://127.0.0.1:9123/gas`. This requires `sui start --with-faucet`. Faucet failures are non-fatal — the wallet still works, it just has no SUI balance. On other networks, fund the wallet address manually.

### Ed25519 keys only

The wallet uses Ed25519 keypairs exclusively. The CLI keystore resolver skips Secp256k1 and Secp256r1 entries. Private keys in Sui keystore format (33-byte base64 with scheme flag prefix) are automatically detected and the scheme byte is stripped.

---

## How It Works

```
Node.js (Playwright)              Browser (Chromium)
┌──────────────────────┐          ┌──────────────────────────┐
│ WalletManager        │          │ Mock Wallet              │
│ ├─ Ed25519Keypair    │◄────────►│ (Wallet Standard v2)     │
│ ├─ SuiGrpcClient     │  bridge  │ ├─ sui:signTransaction   │
│ └─ sign/execute      │ functions│ ├─ sui:signAndExecuteTx   │
└──────────────────────┘          │ └─ sui:signPersonalMsg   │
                                  │                          │
                                  │ dApp Kit discovers       │
                                  │ wallet via Wallet        │
                                  │ Standard events          │
                                  └──────────────────────────┘
```

1. **Bridge binding** — `WalletManager.inject(page)` calls `page.exposeFunction()` to create three Node.js callbacks: `__pw_wallet_sign_tx`, `__pw_wallet_sign_and_exec`, `__pw_wallet_sign_msg`
2. **Init script** — A self-contained JavaScript string (no imports, no bundling) is registered via `addInitScript()`. It creates a mock wallet implementing the Wallet Standard interface and delegates all signing to the bridge callbacks.
3. **Two-phase registration** — The injection script both listens for `wallet-standard:app-ready` and dispatches `wallet-standard:register-wallet`, ensuring the wallet is discovered regardless of whether dApp Kit loads before or after the injection script.
4. **Private key isolation** — The browser never touches key material. All signing happens in Node.js, and only signatures are returned to the browser.

---

## API Reference

### Package Exports

| Import Path | Contents |
|-------------|----------|
| `sui-playwright-wallet` | `WalletManager`, helpers, types, constants |
| `sui-playwright-wallet/fixtures` | Playwright `test` and `expect` with wallet fixtures |
| `sui-playwright-wallet/mcp` | `registerWalletTools()` for composing into MCP servers |
| `sui-wallet-mcp` (CLI) | Standalone MCP server binary |

### WalletManager

| Property / Method | Description |
|-------------------|-------------|
| `address` | Sui address (`0x`-prefixed) |
| `network` | Current network |
| `rpcUrl` | Current RPC URL |
| `publicKeyBase64` | Base64-encoded Ed25519 public key |
| `suiClient` | Underlying `SuiGrpcClient` instance |
| `accountInfo()` | Returns `{ address, publicKey }` |
| `inject(page)` | Inject wallet before navigation. Uses `addInitScript()`. |
| `injectLate(page)` | Inject into already-loaded page. Uses `evaluate()`. |
| `isInjected(page)` | Check if page has been injected |
| `getBalance()` | Get SUI balance (returns `bigint`) |
| `requestFaucet()` | Request SUI from localnet faucet |

### Playwright Helpers

```typescript
import {
  clickConnect,
  waitForConnected,
  isConnected,
  clickDisconnect,
  waitForWalletReady,
  getInjectedWalletInfo,
} from 'sui-playwright-wallet';
```

| Helper | Description |
|--------|-------------|
| `clickConnect(page, opts?)` | Click Connect button, select wallet from modal |
| `waitForConnected(page, timeout?)` | Wait for connected state, return address text |
| `isConnected(page)` | Check if wallet is currently connected |
| `clickDisconnect(page)` | Click Disconnect button |
| `waitForWalletReady(page, timeout?)` | Wait for `__pw_wallet_injected` flag |
| `getInjectedWalletInfo(page)` | Get `{ address, chain }` from the injected wallet |

### MCP Tools

**Browser tools** (15):

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URL (launches Chromium on first call) |
| `browser_snapshot` | Get text content of current page |
| `browser_screenshot` | Capture page as base64 PNG |
| `browser_click` | Click element by selector |
| `browser_type` | Type text into input field |
| `browser_press_key` | Press keyboard key |
| `browser_hover` | Hover over element |
| `browser_select_option` | Select from `<select>` dropdown |
| `browser_evaluate` | Execute JavaScript in browser |
| `browser_wait_for` | Wait for selector to appear |
| `browser_navigate_back` | Go back in browser history |
| `browser_handle_dialog` | Accept or dismiss next dialog |
| `browser_console_messages` | Get last 100 console messages |
| `browser_resize` | Resize browser viewport |
| `browser_close` | Close browser and clean up |

**Wallet tools** (4):

| Tool | Description |
|------|-------------|
| `wallet_setup` | Create keypair, inject wallet, auto-fund on localnet, auto-navigate to dApp |
| `wallet_connect` | Click Connect, select mock wallet, verify connection |
| `wallet_state` | Return address, network, balance, connection status |
| `wallet_disconnect` | Disconnect and clean up |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Playwright Test Wallet" not in Connect modal | Wallet wasn't injected before page load | Call `inject(page)` before `page.goto()`. MCP server handles this automatically. |
| Faucet request fails | Localnet faucet not running | Start Sui with `sui start --with-faucet`. Failures are non-fatal. |
| Transaction signing hangs | RPC not reachable | Verify Sui node is running at the expected URL (localnet: `http://127.0.0.1:9000`). |
| "No browser page" (MCP) | Browser not launched yet | Call `browser_navigate` or `wallet_setup` with `dappUrl` first. |
| `connectedPage` fixture fails | dApp uses non-standard selectors | Add `data-testid="connect-button"` to your ConnectButton, or use `clickConnect()` with custom selectors. |
| `BigInt` serialization error | Processing raw RPC results | The library handles this internally. If you process results yourself, use `JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v)`. |
| CLI keystore key not found | Active address uses Secp256k1/r1 | Only Ed25519 keys are supported. Set `SUI_PRIVATE_KEY` env var instead. |

---

## Development

```bash
npm run build             # tsup → dist/
npm run dev               # tsup --watch
npm run test              # vitest (unit tests)
npm run test:integration  # playwright (requires test-dapp running)
npm run typecheck         # tsc --noEmit
```

The repo includes a test dApp at `tests/fixtures/test-dapp/`:

```bash
cd tests/fixtures/test-dapp && npm install && npm run dev
# → Vite dev server at http://localhost:5173
```

See [SUI_PLAYWRIGHT_WALLET_FOR_DUMMIES.md](./SUI_PLAYWRIGHT_WALLET_FOR_DUMMIES.md) for an extended beginner-friendly tutorial.

## License

MIT

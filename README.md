# sui-playwright-wallet

A mock Sui wallet that injects into Playwright-controlled browsers for automated dApp testing. No browser extensions, no manual approvals — just headless, scriptable wallet interactions.

## Why?

Testing Sui dApps end-to-end is painful. Real wallet extensions don't work in headless browsers, and mocking `window` globals only gets you so far. This library solves it by injecting a fully [Wallet Standard](https://github.com/wallet-standard/wallet-standard)-compliant mock wallet that dApp Kit discovers automatically — while keeping the private key safe in Node.js.

## How It Works

```
┌─────────────────────────────────────────────┐
│  Node.js (Playwright)                       │
│                                             │
│  WalletManager                              │
│  ├─ Ed25519Keypair (private key stays here) │
│  ├─ SuiClient (RPC)                        │
│  └─ Bridge handlers:                        │
│     ├─ signTransaction()                    │
│     ├─ signAndExecuteTransaction()          │
│     └─ signPersonalMessage()                │
│            ▲                                │
│            │ page.exposeFunction()           │
│            ▼                                │
│  ┌──────────────────────────────────┐       │
│  │  Browser (Chromium)              │       │
│  │                                  │       │
│  │  Mock Wallet (Wallet Standard)   │       │
│  │  ├─ standard:connect             │       │
│  │  ├─ standard:disconnect          │       │
│  │  ├─ sui:signTransaction ──────┐  │       │
│  │  ├─ sui:signAndExecuteTransaction│       │
│  │  └─ sui:signPersonalMessage   │  │       │
│  │         │                        │       │
│  │         └── calls __pw_wallet_*  │       │
│  │             bridge functions     │       │
│  │                                  │       │
│  │  dApp Kit ← discovers wallet    │       │
│  │  via Wallet Standard events      │       │
│  └──────────────────────────────────┘       │
└─────────────────────────────────────────────┘
```

The private key never leaves Node.js. The browser-side wallet is a thin shell that delegates all cryptographic operations back through Playwright's `page.exposeFunction()` bridges.

## Install

```bash
npm install sui-playwright-wallet
```

## Usage

### As a Library (Playwright Tests)

```typescript
import { test, expect } from 'sui-playwright-wallet/fixtures';

test('can sign a transaction', async ({ connectedPage, wallet }) => {
  // connectedPage already has the wallet injected and connected
  await connectedPage.click('[data-testid="sign-tx-button"]');

  // Check the wallet address is displayed
  const address = await connectedPage.textContent('[data-testid="account-address"]');
  expect(address).toBe(wallet.address);
});
```

The fixtures give you:
- **`wallet`** — a `WalletManager` with a fresh keypair (auto-funded on localnet)
- **`connectedPage`** — a Playwright `Page` with the wallet injected and connected to your dApp

### Manual Setup

```typescript
import { WalletManager } from 'sui-playwright-wallet';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

// Create a wallet (random keypair, localnet by default)
const wallet = new WalletManager({ network: 'localnet' });

// Inject BEFORE navigating — the init script runs before any page JS
await wallet.inject(page);

// Now navigate to your dApp — it will discover the wallet automatically
await page.goto('http://localhost:5173');
```

### As a Claude Code Plugin

Install the `sui-wallet` plugin for zero-config MCP integration:

```bash
claude plugin add ~/workspace/claudefiles/plugins/sui-wallet
```

Then use the `/sui-wallet` command for guided setup:

```
/sui-wallet http://localhost:5173 localnet
```

The plugin registers the MCP server automatically — no `.mcp.json` editing required.

### As an MCP Server (Manual Configuration)

The library ships with a standalone MCP server that provides both browser control and wallet tools in a single process. Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "sui-wallet": {
      "command": "npx",
      "args": ["sui-wallet-mcp"],
      "env": { "DAPP_URL": "http://localhost:5173", "HEADLESS": "true" }
    }
  }
}
```

Set `HEADLESS=false` to open a visible browser window (useful for debugging).

This gives AI agents 19 tools for browser automation + wallet operations:

| Category | Tools |
|----------|-------|
| Navigation | `browser_navigate`, `browser_navigate_back` |
| Interaction | `browser_click`, `browser_type`, `browser_press_key`, `browser_hover`, `browser_select_option` |
| Observation | `browser_snapshot`, `browser_screenshot`, `browser_console_messages` |
| Control | `browser_wait_for`, `browser_handle_dialog`, `browser_evaluate`, `browser_resize`, `browser_close` |
| Wallet | `wallet_setup`, `wallet_connect`, `wallet_state`, `wallet_disconnect` |

### Composing with Your Own MCP Server

If you already have an MCP server and want to add wallet tools:

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

## API

### `WalletManager`

```typescript
const wallet = new WalletManager({
  privateKey?: string,   // Hex (0x-prefixed or raw) or base64
  mnemonic?: string,     // BIP-39 mnemonic
  network?: 'localnet' | 'devnet' | 'testnet' | 'mainnet',  // default: 'localnet'
  rpcUrl?: string,       // Custom RPC URL (overrides network default)
});
```

| Method | Description |
|--------|-------------|
| `inject(page)` | Inject wallet before navigation. Uses `addInitScript()`. |
| `injectLate(page)` | Inject into an already-loaded page. Uses `evaluate()`. |
| `isInjected(page)` | Check if a page has been injected. |
| `getBalance()` | Get SUI balance (returns `bigint`). |
| `requestFaucet()` | Request SUI from localnet faucet. |

| Property | Description |
|----------|-------------|
| `address` | Sui address (0x-prefixed) |
| `network` | Current network |
| `rpcUrl` | Current RPC URL |
| `publicKeyBase64` | Base64-encoded Ed25519 public key |
| `suiClient` | Underlying `SuiClient` instance |

### Playwright Helpers

```typescript
import { clickConnect, waitForConnected, isConnected, clickDisconnect } from 'sui-playwright-wallet';

await clickConnect(page, {
  walletName: 'Playwright Test Wallet',  // default
  connectSelector: '[data-testid="connect-button"]',  // optional override
  walletSelector: 'text=Playwright Test Wallet',  // optional override
});

await waitForConnected(page);  // waits for [data-testid="account-address"]
const connected = await isConnected(page);
await clickDisconnect(page);
```

## Supported Wallet Features

| Feature | Version | Notes |
|---------|---------|-------|
| `standard:connect` | 1.0.0 | Auto-approves (no popup) |
| `standard:disconnect` | 1.0.0 | |
| `standard:events` | 1.0.0 | Emits `change` events |
| `sui:signTransaction` | 2.0.0 | Delegates to Node.js |
| `sui:signAndExecuteTransaction` | 2.0.0 | Signs + executes via RPC |
| `sui:signPersonalMessage` | 1.1.0 | Delegates to Node.js |

## Important Notes

- **Call `inject()` before `page.goto()`** — the wallet must register before dApp Kit initializes
- **Use `injectLate()` for already-loaded pages** — it uses `evaluate()` instead of `addInitScript()`
- **The MCP server owns the browser** — don't use it alongside a separate Playwright MCP plugin (they'd create separate pages)
- **Localnet auto-funding** — on localnet, `inject()` and `wallet_setup` automatically request SUI from the faucet

## Development

```bash
npm run build      # Build library + MCP server
npm run dev        # Watch mode
npm run test       # Run tests
npm run typecheck  # Type-check with tsc
```

## License

MIT

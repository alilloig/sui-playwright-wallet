# sui-playwright-wallet for Dummies

A beginner's guide to automating Sui dApp wallet interactions in Playwright tests and AI agents.

---

## 1. What Is This?

Testing a Sui dApp end-to-end is a headache. Real wallet browser extensions (like Sui Wallet or Ethos) don't work in headless Chromium, and mocking globals only gets you partway there. You end up unable to test the most critical flows: connecting a wallet, signing transactions, and verifying on-chain results.

sui-playwright-wallet solves this by injecting a fake wallet into any Playwright-controlled browser. This fake wallet looks real to your dApp — it implements the full [Wallet Standard](https://github.com/wallet-standard/wallet-standard) interface, so Mysten's dApp Kit discovers and uses it like any other wallet. All signing happens in Node.js where your private key lives. The browser never touches key material.

After following this guide, you'll be able to write Playwright tests that connect a wallet, sign transactions, and verify results — all headless, all automated, zero popups.

---

## 2. How It All Fits Together

```
 ┌──────────────────────────────────┐
 │       Node.js (your test)        │
 │                                  │
 │   WalletManager                  │
 │   ┌────────────────────────────┐ │
 │   │ Ed25519Keypair (secret key)│ │
 │   │ SuiClient (RPC to chain)  │ │
 │   └──────────┬─────────────────┘ │
 │              │                   │
 │   page.exposeFunction()         │
 │   (creates 3 bridge callbacks)   │
 │              │                   │
 ├──────────────┼───────────────────┤
 │              ▼                   │
 │   Browser (Chromium)             │
 │   ┌────────────────────────────┐ │
 │   │ Mock Wallet (JS string)   │ │
 │   │ Implements Wallet Standard │ │
 │   │                            │ │
 │   │ When dApp requests signing:│ │
 │   │  → calls __pw_wallet_*()  │ │
 │   │  → bridge sends to Node   │ │
 │   │  → Node signs, returns    │ │
 │   └────────────────────────────┘ │
 │                                  │
 │   Your dApp (React + dApp Kit)   │
 │   discovers wallet via           │
 │   Wallet Standard events         │
 └──────────────────────────────────┘
```

There are three pieces working together:

- **WalletManager** (Node.js) — holds the Ed25519 private key and a `SuiClient` for RPC calls. Signs transactions and personal messages when the browser asks.
- **Injection Script** (browser) — a self-contained JavaScript string (no imports) that registers a fake wallet called "Playwright Test Wallet" via Wallet Standard events. When your dApp calls `signTransaction()`, the script forwards the bytes to Node.js through a Playwright bridge function.
- **dApp Kit** (browser) — your dApp uses `@mysten/dapp-kit`, which discovers wallets via the Wallet Standard event protocol. It finds the mock wallet and treats it as real.

---

## 3. Prerequisites

- **Node.js 18+** — the library targets Node 18
  ```bash
  node --version   # must be >= 18
  ```
- **npm** (comes with Node.js)
- **Playwright browsers** — Chromium needs to be installed
  ```bash
  npx playwright install chromium
  ```
- **A Sui dApp to test** — a React app using `@mysten/dapp-kit`. If you don't have one, the library includes a test dApp (see section 6).
- **(Optional) A running Sui localnet** — only needed if you want to execute real transactions. The wallet works without it for connection-only tests.
  ```bash
  # If you use the Sui CLI:
  sui start --with-faucet
  ```

---

## 4. First-Time Setup

1. **Install the library** in your project:
   ```bash
   npm install sui-playwright-wallet
   ```
   This installs the core library. It pulls in `@mysten/sui` (for keypairs and RPC) and `playwright` (for browser automation) as dependencies.

2. **Install test framework peer dependencies** (if writing Playwright tests):
   ```bash
   npm install -D @playwright/test
   ```
   The library's test fixtures import from `@playwright/test`. This is a peer dependency, so you install it yourself.

3. **Build the library** (only needed if you cloned the source repo):
   ```bash
   npm run build
   ```
   This runs `tsup`, which produces two outputs:
   - `dist/index.js` + `dist/playwright/fixtures.js` — the library and test fixtures
   - `dist/mcp/server.js` — a standalone MCP server executable (for AI agent usage)

---

## 5. Core Usage: Writing Your First Test

The fastest way to use this library is through the Playwright fixtures. They handle wallet creation, injection, and connection for you.

Create a test file (e.g., `tests/wallet.spec.ts`):

```typescript
import { test, expect } from 'sui-playwright-wallet/fixtures';

test('wallet connects and shows address', async ({ connectedPage, wallet }) => {
  // connectedPage already has:
  // 1. A fresh wallet injected (random keypair)
  // 2. Navigated to http://localhost:5173
  // 3. Clicked "Connect Wallet" and selected the mock wallet

  const address = await connectedPage.textContent('[data-testid="account-address"]');
  expect(address).toBe(wallet.address);
});

test('can sign a transaction', async ({ connectedPage }) => {
  await connectedPage.click('[data-testid="sign-tx-button"]');

  // Wait for the result to appear — signing goes through Node.js and back
  await connectedPage.waitForSelector('[data-testid="tx-result"]');
  const result = await connectedPage.textContent('[data-testid="tx-result"]');
  expect(result).toContain('digest');
});
```

Run it:

```bash
npx playwright test tests/wallet.spec.ts
```

Here's what happens behind the scenes when the test runs:

1. The `wallet` fixture creates a `WalletManager` with a random Ed25519 keypair on localnet. If a local Sui node is running, it requests SUI from the faucet at `http://127.0.0.1:9123/gas`.
2. The `connectedPage` fixture calls `wallet.inject(page)`, which exposes three bridge functions (`__pw_wallet_sign_tx`, `__pw_wallet_sign_and_exec`, `__pw_wallet_sign_msg`) and adds an init script that registers the mock wallet.
3. It navigates to `http://localhost:5173` (your dApp).
4. It clicks the Connect Wallet button and selects "Playwright Test Wallet" from the modal.
5. Your test code runs with a fully connected wallet.

> **Note:** The fixtures default to `localnet` and `http://localhost:5173`. You can override these — see the [Configuration Reference](#appendix-a-configuration-reference).

---

## 6. Day-to-Day Workflow

```bash
# Start your dApp's dev server (in one terminal)
cd my-dapp
npm run dev
# → Vite serves at http://localhost:5173

# Start a local Sui node (in another terminal, if you need on-chain tx)
sui start --with-faucet
# → RPC at http://127.0.0.1:9000, faucet at http://127.0.0.1:9123/gas

# Run your wallet tests
npx playwright test

# Run a specific test file
npx playwright test tests/wallet.spec.ts

# Run in headed mode to see the browser
npx playwright test --headed

# Run with trace recording for debugging
npx playwright test --trace on
```

If you don't have a dApp yet, the library ships with a minimal test dApp you can use:

```bash
cd tests/fixtures/test-dapp
npm install
npm run dev
# → Vite serves a React + dApp Kit app at http://localhost:5173
# → Has ConnectButton, Sign Transaction, and Sign Message buttons
# → All elements have data-testid attributes for test targeting
```

---

## 7. Using Without Fixtures (Manual Setup)

If you need more control — different network, specific private key, custom injection timing — use `WalletManager` directly:

```typescript
import { WalletManager, clickConnect, waitForConnected } from 'sui-playwright-wallet';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

// Create a wallet on testnet with a specific key
const wallet = new WalletManager({
  network: 'testnet',
  privateKey: '0xYOUR_HEX_PRIVATE_KEY',
});

// IMPORTANT: inject BEFORE navigating to the dApp
await wallet.inject(page);

// Now navigate — the init script runs before any page JavaScript
await page.goto('http://localhost:5173');

// Use helpers to connect through the dApp Kit UI
await clickConnect(page);
const address = await waitForConnected(page);
console.log('Connected:', address);

// Your dApp is now connected to the mock wallet
await browser.close();
```

> **Note:** Always call `wallet.inject(page)` before `page.goto()`. The injection script uses `addInitScript()`, which runs before any page JavaScript loads. This ensures the wallet is registered before dApp Kit initializes. If you need to inject into a page that's already loaded, use `wallet.injectLate(page)` instead — it runs the script via `page.evaluate()`.

---

## 8. Using as an MCP Server (AI Agents)

The library includes a standalone MCP server that combines browser control and wallet operations in a single process. This is for AI coding agents (like Claude Code) that need to test dApps.

Add this to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "sui-wallet": {
      "command": "node",
      "args": ["./node_modules/sui-playwright-wallet/dist/mcp/server.js"]
    }
  }
}
```

After restarting Claude Code (or running `/mcp`), you get 19 tools — 15 for browser control and 4 for wallet operations. A typical flow looks like:

1. `wallet_setup({ network: "localnet" })` — creates a keypair, auto-funds via faucet
2. `browser_navigate({ url: "http://localhost:5173" })` — opens your dApp
3. `wallet_connect({})` — clicks Connect → selects Playwright Test Wallet
4. `browser_click({ selector: "[data-testid='sign-tx-button']" })` — triggers signing
5. `wallet_state({})` — checks address, balance, connection status

> **Note:** The MCP server owns its own Playwright browser. Don't use it alongside a separate Playwright MCP plugin — they'd create two separate browser instances with separate pages, and the wallet bridge only works in the server's browser.

---

## 9. Writing MCP Server Config Files

If you want to add wallet tools to your own MCP server (instead of using the standalone one), here's the pattern:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWalletTools } from 'sui-playwright-wallet';

const server = new McpServer({ name: 'my-server', version: '1.0.0' });

// currentPage must be a Playwright Page that your server manages
registerWalletTools(server, () => currentPage);
```

**DO:**
- Make sure `getPage` returns the same Page instance that the user navigates — the wallet bridge functions are bound to a specific page via `exposeFunction()`.
- Call `wallet_setup` before `wallet_connect` — setup injects the wallet, connect clicks through the UI.

**DON'T:**
- Don't create a new Page between `wallet_setup` and `wallet_connect` — the bridge functions are bound to the page that was active during setup.
- Don't use this alongside the standalone MCP server — you'd have two competing browser instances.

---

## 10. Troubleshooting

**"Playwright Test Wallet" doesn't appear in the Connect modal** — the wallet wasn't injected before the page loaded. Make sure you call `wallet.inject(page)` before `page.goto()`. If the page is already loaded, use `wallet.injectLate(page)` instead.

**Faucet request fails** — the localnet faucet must be running at `http://127.0.0.1:9123/gas`. Start Sui with `sui start --with-faucet`. Faucet failures are non-fatal — the wallet still works, it just has no SUI balance.

**Transaction signing hangs** — the bridge function timed out. Check that your Sui localnet RPC is running at `http://127.0.0.1:9000`. The `signAndExecuteTransaction` feature calls `client.executeTransactionBlock()`, which needs a live RPC.

**"No browser page. Call browser_navigate first."** (MCP server) — the MCP server lazily launches the browser. Call `browser_navigate` before any other browser or wallet tool.

**`connectedPage` fixture fails to connect** — your dApp's Connect button markup doesn't match the default selectors. The fixture looks for `[data-testid="connect-button"]`, `button:has-text("Connect Wallet")`, or `button:has-text("Connect")`. Add a `data-testid="connect-button"` to your ConnectButton, or pass custom selectors via `clickConnect()`.

**BigInt serialization error** — if you see `TypeError: Do not know how to serialize a BigInt`, the library handles this internally with a `bigIntReplacer` function. If you're processing wallet RPC results yourself, use `JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v)`.

---

## Appendix A: Configuration Reference

### Fixture Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `walletNetwork` | `'localnet' \| 'devnet' \| 'testnet' \| 'mainnet'` | `'localnet'` | Sui network to target |
| `dappUrl` | `string` | `'http://localhost:5173'` | URL of the dApp to test against |
| `walletPrivateKey` | `string \| undefined` | `undefined` (random) | Hex or base64 private key for the wallet |

Override in your Playwright config or test file:

```typescript
import { test } from 'sui-playwright-wallet/fixtures';

test.use({
  walletNetwork: 'testnet',
  dappUrl: 'http://localhost:3000',
});
```

### WalletManager Constructor

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `privateKey` | `string` | Random keypair | Hex (0x-prefixed or raw) or base64-encoded Ed25519 private key |
| `mnemonic` | `string` | Random keypair | BIP-39 mnemonic phrase |
| `network` | `SuiNetwork` | `'localnet'` | Target network |
| `rpcUrl` | `string` | Derived from network | Custom RPC URL (overrides network default) |

### Network Default URLs

| Network | RPC URL | Faucet |
|---------|---------|--------|
| `localnet` | `http://127.0.0.1:9000` | `http://127.0.0.1:9123/gas` |
| `devnet` | `https://fullnode.devnet.sui.io:443` | — |
| `testnet` | `https://fullnode.testnet.sui.io:443` | — |
| `mainnet` | `https://fullnode.mainnet.sui.io:443` | — |

---

## Appendix B: MCP Server Tools

### Browser Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL. Launches Chromium on first call. |
| `browser_snapshot` | Get text content of the current page. |
| `browser_screenshot` | Take a PNG screenshot (returned as base64). |
| `browser_click` | Click an element by CSS/text/data-testid selector. |
| `browser_type` | Type text into an input field. |
| `browser_press_key` | Press a keyboard key (Enter, Tab, Escape, etc.). |
| `browser_hover` | Hover over an element. |
| `browser_select_option` | Select from a `<select>` dropdown. |
| `browser_evaluate` | Execute JavaScript in the browser and return the result. |
| `browser_wait_for` | Wait for a selector to appear (default timeout: 5000ms). |
| `browser_navigate_back` | Go back in browser history. |
| `browser_handle_dialog` | Accept or dismiss the next alert/confirm/prompt dialog. |
| `browser_console_messages` | Get the last 100 console messages (log, warn, error). |
| `browser_resize` | Resize the browser viewport. |
| `browser_close` | Close the browser and clean up all state. |

### Wallet Tools

| Tool | Description |
|------|-------------|
| `wallet_setup` | Create keypair, inject mock wallet, auto-fund on localnet. |
| `wallet_connect` | Click Connect button, select wallet, verify connection. |
| `wallet_state` | Return address, network, balance, connection status. |
| `wallet_disconnect` | Disconnect wallet and clean up state. |

---

## Appendix C: How It Boots (Under the Hood)

Here's what happens when you call `wallet.inject(page)`:

1. **Bridge binding** — three Node.js functions are exposed to the browser via `page.exposeFunction()`:
   - `__pw_wallet_sign_tx` — receives base64 transaction bytes, returns base64 signature
   - `__pw_wallet_sign_and_exec` — receives base64 tx bytes, signs, executes via RPC, returns JSON result
   - `__pw_wallet_sign_msg` — receives base64 message bytes, returns base64 signature

2. **Init script registration** — `page.addInitScript()` injects a self-contained JavaScript string that runs before any page JavaScript on every navigation. This script:
   - Creates a `MockSuiWallet` object implementing the Wallet Standard interface
   - Implements `standard:connect`, `standard:disconnect`, `standard:events`
   - Implements `sui:signTransaction` (v2.0.0), `sui:signAndExecuteTransaction` (v2.0.0), `sui:signPersonalMessage` (v1.1.0)
   - Each signing feature serializes bytes to base64, calls the bridge function, and deserializes the result

3. **Two-phase wallet registration** — the injection script registers with dApp Kit via the Wallet Standard event protocol:
   - Phase 1: Listens for `wallet-standard:app-ready` (handles dApp Kit loading after the wallet script)
   - Phase 2: Dispatches `wallet-standard:register-wallet` (handles dApp Kit already being loaded)
   - This bidirectional approach ensures registration works regardless of script load order.

4. **Marker flags** — the script sets `window.__pw_wallet_injected = true` and `window.__pw_wallet_info = { address, chain }` so test code can verify injection happened.

---

## Appendix D: All npm Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build library + MCP server via tsup |
| `npm run dev` | Watch mode (rebuilds on file changes) |
| `npm run test` | Run tests via vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm run lint` | Same as typecheck |

---

## Appendix E: Glossary

**Wallet Standard** — a browser-level protocol for wallet discovery. Wallets and dApps communicate via `CustomEvent` dispatch on `window`, so they don't need to know about each other in advance.

**dApp Kit** — Mysten Labs' official React library (`@mysten/dapp-kit`) for connecting Sui wallets to dApps. It discovers wallets via the Wallet Standard.

**Bridge function** — a Node.js function made callable from the browser via Playwright's `page.exposeFunction()`. The browser calls `window.__pw_wallet_sign_tx(base64)`, which executes in Node.js and returns the result.

**Init script** — a JavaScript snippet registered via `page.addInitScript()` that runs before any page JavaScript on every navigation. Used to register the mock wallet before dApp Kit initializes.

**MIST** — the smallest unit of SUI (1 SUI = 1,000,000,000 MIST). Similar to wei in Ethereum.

**Ed25519** — the elliptic curve signature algorithm used by Sui for account keypairs.

---

## Appendix F: Important Files

| File | Description |
|------|-------------|
| `src/wallet/manager.ts` | `WalletManager` class — keypair, bridge handlers, injection logic |
| `src/wallet/inject.ts` | `buildInjectScript()` — generates the browser-side wallet (raw JS string) |
| `src/wallet/types.ts` | All shared TypeScript types and network URL constants |
| `src/mcp/server.ts` | Standalone MCP server (19 tools: 15 browser + 4 wallet) |
| `src/mcp/tools.ts` | MCP tool schemas and handler factories (composable) |
| `src/mcp/register.ts` | `registerWalletTools()` — one-liner to add wallet tools to any MCP server |
| `src/playwright/fixtures.ts` | Playwright test fixtures (`wallet`, `connectedPage`) |
| `src/playwright/helpers.ts` | `clickConnect()`, `waitForConnected()`, `isConnected()`, etc. |
| `src/index.ts` | Public API re-exports |
| `tsup.config.ts` | Dual build config (library + standalone MCP server) |
| `tests/fixtures/test-dapp/` | Minimal Vite + React + dApp Kit test app |

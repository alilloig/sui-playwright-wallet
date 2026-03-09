# sui-playwright-wallet

Mock Sui wallet for Playwright-based dApp testing. Injects a Wallet Standard-compliant wallet into the browser with all signing delegated to Node.js via `page.exposeFunction()` bridges.

## Commands

```bash
npm run build      # tsup → dist/
npm run dev        # tsup --watch
npm run test       # vitest run
npm run test:watch # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # tsc --noEmit (same as typecheck)
```

## Project Structure

```
src/
├── index.ts              # Public API re-exports
├── wallet/
│   ├── manager.ts        # WalletManager — holds keypair, exposes bridge functions
│   ├── inject.ts         # Browser injection script (string template, no imports)
│   └── types.ts          # Shared types (WalletConfig, SuiNetwork, etc.)
├── mcp/
│   ├── server.ts         # Standalone MCP server (browser + wallet tools)
│   ├── tools.ts          # MCP tool schemas & handlers (composable)
│   └── register.ts       # registerWalletTools() helper for external MCP servers
└── playwright/
    ├── fixtures.ts       # Playwright test fixtures (wallet, connectedPage)
    └── helpers.ts        # clickConnect, waitForConnected, etc.

tests/
├── unit/                 # (ready for tests)
├── integration/          # (ready for tests)
└── fixtures/test-dapp/   # Minimal Vite + React + dApp Kit test app
```

## Architecture

### Bridge Pattern (Critical)

The private key **never leaves Node.js**. The browser gets a thin mock wallet that delegates signing back to Node.js:

1. `WalletManager.inject(page)` calls `page.exposeFunction()` to create three bridges:
   - `__pw_wallet_sign_tx` → `keypair.signTransaction()`
   - `__pw_wallet_sign_and_exec` → sign + `client.executeTransactionBlock()`
   - `__pw_wallet_sign_msg` → `keypair.signPersonalMessage()`
2. An init script registers a Wallet Standard wallet that calls these bridges
3. dApp Kit discovers the wallet via the standard event protocol

### Wallet Standard Registration (Two-Phase)

The injection script uses a bidirectional event protocol:
- **Phase 1**: Listen for `wallet-standard:app-ready` (dApp Kit loads after wallet)
- **Phase 2**: Dispatch `wallet-standard:register-wallet` (dApp Kit already loaded)

This ensures the wallet is registered regardless of script load order.

### Injection Timing

- `inject(page)` — use BEFORE `page.goto()`. Uses `addInitScript()` (survives navigations).
- `injectLate(page)` — use on ALREADY-LOADED pages. Uses `page.evaluate()`.

### Dual Build System (tsup)

1. **Library build**: `index.ts` + `playwright/fixtures.ts` → ESM with `.d.ts`, external: `@playwright/test`, `@modelcontextprotocol/sdk`
2. **MCP server build**: `mcp/server.ts` → standalone executable with shebang, bundles MCP SDK + Sui SDK, external: `playwright`

## Key Constraints

- The injection script (`inject.ts`) is a **raw JS string template** — no imports, no bundling. It runs in the browser. All crypto/signing must go through the bridge functions.
- `JSON.stringify` on RPC results requires `bigIntReplacer` because Sui responses can contain BigInt values.
- The standalone MCP server owns both browser and wallet in one process. You **cannot** use it alongside a separate Playwright MCP plugin (they'd create separate pages).
- The wallet name in the injection script is hardcoded to `"Playwright Test Wallet"`. The `wallet_connect` tool's `walletName` parameter must match.
- Base64 encoding in the injection script uses manual `btoa`/`atob` loops (no Node.js `Buffer` in browser).

## Exports

```
"."         → dist/index.js        # WalletManager, types, MCP tools, helpers
"./fixtures" → dist/playwright/fixtures.js  # Playwright test fixtures
bin: sui-wallet-mcp → dist/mcp/server.js    # Standalone MCP server
```

## MCP Server Tools

The standalone server (`src/mcp/server.ts`) provides 19 tools:

**Browser**: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_evaluate`, `browser_wait_for`, `browser_press_key`, `browser_hover`, `browser_select_option`, `browser_navigate_back`, `browser_handle_dialog`, `browser_console_messages`, `browser_resize`, `browser_close`

**Wallet**: `wallet_setup`, `wallet_connect`, `wallet_state`, `wallet_disconnect`

## Dependencies

- `@mysten/sui` — Ed25519 keypairs, SuiClient, transaction signing
- `playwright` — browser automation (runtime)
- `@playwright/test` — test fixtures (peer, optional)
- `@modelcontextprotocol/sdk` — MCP server (peer, optional)

## Test dApp

`tests/fixtures/test-dapp/` is a Vite + React + dApp Kit app. All interactive elements use `data-testid` attributes for reliable test targeting. Start it with:

```bash
cd tests/fixtures/test-dapp && npm install && npm run dev
```

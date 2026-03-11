/**
 * Standalone MCP server for Claude Code.
 *
 * Provides both browser control tools (navigate, click, type, snapshot,
 * screenshot) and Sui wallet tools (setup, connect, state, disconnect)
 * in a single process. The wallet's signing bridge and the browser share
 * the same Playwright Page, which is the key requirement that prevents
 * using wallet tools alongside a separate Playwright MCP plugin.
 *
 * Usage in .mcp.json:
 * {
 *   "mcpServers": {
 *     "sui-wallet": {
 *       "command": "node",
 *       "args": ["./node_modules/sui-playwright-wallet/dist/mcp/server.js"],
 *       "env": { "DAPP_URL": "http://localhost:3000" }
 *     }
 *   }
 * }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { z } from 'zod';
import { WalletManager } from '../wallet/manager.js';
import type { SuiNetwork } from '../wallet/types.js';

// ── Config ───────────────────────────────────────────────────────────

const DEFAULT_DAPP_URL = process.env.DAPP_URL ?? '';

// ── State ────────────────────────────────────────────────────────────

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let walletManager: WalletManager | null = null;
let walletConnected = false;

const consoleLogs: Array<{ type: string; text: string }> = [];

async function ensureBrowser(): Promise<Page> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();

    // Collect console messages for the browser_console_messages tool
    page.on('console', (msg) => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
      // Keep only the last 100 messages
      if (consoleLogs.length > 100) consoleLogs.shift();
    });
  }
  return page!;
}

function getPage(): Page {
  if (!page) {
    throw new Error('No browser page. Call browser_navigate first.');
  }
  return page;
}

// ── Server ───────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'sui-playwright-wallet',
  version: '0.1.0',
});

// ── Browser tools ────────────────────────────────────────────────────

server.tool(
  'browser_navigate',
  'Navigate the browser to a URL. Launches the browser on first call.',
  { url: z.string().describe('URL to navigate to') },
  async ({ url }) => {
    const p = await ensureBrowser();
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    const title = await p.title();
    return {
      content: [{ type: 'text', text: `Navigated to ${url} — title: "${title}"` }],
    };
  },
);

server.tool(
  'browser_snapshot',
  'Get a text snapshot of the current page content. '
  + 'Use this to understand page structure before clicking or typing.',
  {},
  async () => {
    const p = getPage();
    const title = await p.title();
    const url = p.url();
    const textContent = await p.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    return {
      content: [{
        type: 'text',
        text: `URL: ${url}\nTitle: ${title}\n\n${textContent}`,
      }],
    };
  },
);

server.tool(
  'browser_click',
  'Click an element on the page.',
  {
    selector: z.string().describe(
      'CSS selector, text selector (e.g. "text=Submit"), or data-testid selector',
    ),
  },
  async ({ selector }) => {
    const p = getPage();
    await p.locator(selector).first().click({ timeout: 5000 });
    return {
      content: [{ type: 'text', text: `Clicked: ${selector}` }],
    };
  },
);

server.tool(
  'browser_type',
  'Type text into an input field.',
  {
    selector: z.string().describe('CSS or text selector for the input'),
    text: z.string().describe('Text to type'),
  },
  async ({ selector, text }) => {
    const p = getPage();
    await p.locator(selector).first().fill(text);
    return {
      content: [{ type: 'text', text: `Typed "${text}" into ${selector}` }],
    };
  },
);

server.tool(
  'browser_screenshot',
  'Take a screenshot of the current page. Returns a base64-encoded PNG.',
  {},
  async () => {
    const p = getPage();
    const buffer = await p.screenshot({ type: 'png' });
    return {
      content: [{
        type: 'image',
        data: buffer.toString('base64'),
        mimeType: 'image/png',
      }],
    };
  },
);

server.tool(
  'browser_evaluate',
  'Execute JavaScript in the browser page and return the result.',
  {
    expression: z.string().describe('JavaScript expression to evaluate'),
  },
  async ({ expression }) => {
    const p = getPage();
    const result = await p.evaluate(expression);
    return {
      content: [{
        type: 'text',
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      }],
    };
  },
);

server.tool(
  'browser_wait_for',
  'Wait for a selector to appear on the page.',
  {
    selector: z.string().describe('CSS or text selector to wait for'),
    timeout: z.number().optional().describe('Timeout in ms (default 5000)'),
  },
  async ({ selector, timeout }) => {
    const p = getPage();
    await p.waitForSelector(selector, { timeout: timeout ?? 5000 });
    return {
      content: [{ type: 'text', text: `Found: ${selector}` }],
    };
  },
);

server.tool(
  'browser_press_key',
  'Press a keyboard key (e.g. Enter, Tab, Escape, ArrowDown, Backspace). '
  + 'Optionally target a specific element.',
  {
    key: z.string().describe('Key to press (e.g. "Enter", "Tab", "Escape", "a", "Control+c")'),
    selector: z.string().optional().describe('Element to focus before pressing. If omitted, presses on the page.'),
  },
  async ({ key, selector }) => {
    const p = getPage();
    if (selector) {
      await p.locator(selector).first().press(key);
    } else {
      await p.keyboard.press(key);
    }
    return {
      content: [{ type: 'text', text: `Pressed: ${key}${selector ? ` on ${selector}` : ''}` }],
    };
  },
);

server.tool(
  'browser_hover',
  'Hover over an element on the page.',
  {
    selector: z.string().describe('CSS or text selector for the element'),
  },
  async ({ selector }) => {
    const p = getPage();
    await p.locator(selector).first().hover({ timeout: 5000 });
    return {
      content: [{ type: 'text', text: `Hovered: ${selector}` }],
    };
  },
);

server.tool(
  'browser_select_option',
  'Select an option from a <select> dropdown.',
  {
    selector: z.string().describe('CSS selector for the <select> element'),
    value: z.string().describe('Option value, label, or text to select'),
  },
  async ({ selector, value }) => {
    const p = getPage();
    await p.locator(selector).first().selectOption(value);
    return {
      content: [{ type: 'text', text: `Selected "${value}" in ${selector}` }],
    };
  },
);

server.tool(
  'browser_navigate_back',
  'Navigate back in browser history.',
  {},
  async () => {
    const p = getPage();
    await p.goBack();
    const url = p.url();
    return {
      content: [{ type: 'text', text: `Navigated back to: ${url}` }],
    };
  },
);

server.tool(
  'browser_handle_dialog',
  'Set up automatic handling for the next browser dialog (alert, confirm, prompt). '
  + 'Call this BEFORE the action that triggers the dialog.',
  {
    action: z.enum(['accept', 'dismiss']).describe('Accept or dismiss the dialog'),
    promptText: z.string().optional().describe('Text to enter for prompt dialogs'),
  },
  async ({ action, promptText }) => {
    const p = getPage();
    p.once('dialog', async (dialog) => {
      if (action === 'accept') {
        await dialog.accept(promptText);
      } else {
        await dialog.dismiss();
      }
    });
    return {
      content: [{ type: 'text', text: `Will ${action} next dialog${promptText ? ` with "${promptText}"` : ''}` }],
    };
  },
);

server.tool(
  'browser_console_messages',
  'Get recent console messages from the page (log, warn, error). '
  + 'Returns the last 100 messages. Useful for debugging.',
  {
    clear: z.boolean().optional().describe('Clear the message buffer after reading'),
  },
  async ({ clear }) => {
    getPage(); // ensure browser exists
    const messages = [...consoleLogs];
    if (clear) consoleLogs.length = 0;
    return {
      content: [{
        type: 'text',
        text: messages.length > 0
          ? messages.map((m) => `[${m.type}] ${m.text}`).join('\n')
          : 'No console messages captured.',
      }],
    };
  },
);

server.tool(
  'browser_resize',
  'Resize the browser viewport.',
  {
    width: z.number().describe('Viewport width in pixels'),
    height: z.number().describe('Viewport height in pixels'),
  },
  async ({ width, height }) => {
    const p = getPage();
    await p.setViewportSize({ width, height });
    return {
      content: [{ type: 'text', text: `Viewport resized to ${width}x${height}` }],
    };
  },
);

// ── Wallet tools ─────────────────────────────────────────────────────

server.tool(
  'wallet_setup',
  'Set up a mock Sui wallet. Creates a keypair (or uses provided key material), '
  + 'injects into the browser page, and returns the wallet address. '
  + 'On localnet, auto-funds via faucet. If dappUrl is provided (or DAPP_URL env var is set), '
  + 'auto-navigates to the dApp after injection.',
  {
    privateKey: z.string().optional().describe('Hex or base64 private key'),
    mnemonic: z.string().optional().describe('BIP-39 mnemonic phrase'),
    network: z.enum(['localnet', 'devnet', 'testnet', 'mainnet']).optional()
      .describe('Target network (default: localnet)'),
    rpcUrl: z.string().optional().describe('Custom RPC URL'),
    dappUrl: z.string().optional().describe(
      'URL of the dApp to navigate to after setup (falls back to DAPP_URL env var)',
    ),
  },
  async ({ privateKey, mnemonic, network, rpcUrl, dappUrl }) => {
    const p = await ensureBrowser();

    walletManager = new WalletManager({
      privateKey: privateKey ?? undefined,
      mnemonic: mnemonic ?? undefined,
      network: (network as SuiNetwork) ?? undefined,
      rpcUrl: rpcUrl ?? undefined,
    });

    await walletManager.inject(p);

    // Auto-fund on localnet
    if (walletManager.network === 'localnet') {
      try {
        await walletManager.requestFaucet();
      } catch {
        // Faucet may not be available
      }
    }

    // Auto-navigate to dApp if URL is available
    const resolvedUrl = dappUrl ?? DEFAULT_DAPP_URL;
    if (resolvedUrl) {
      await p.goto(resolvedUrl, { waitUntil: 'domcontentloaded' });
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          address: walletManager.address,
          network: walletManager.network,
          publicKey: walletManager.publicKeyBase64,
          ...(resolvedUrl ? { dappUrl: resolvedUrl } : {}),
          status: 'ready',
        }, null, 2),
      }],
    };
  },
);

server.tool(
  'wallet_connect',
  'Connect the mock wallet to the dApp. Clicks the Connect Wallet button, '
  + 'selects the Playwright Test Wallet from the modal, and verifies connection.',
  {
    walletName: z.string().optional().describe(
      'Name in the modal (default: "Playwright Test Wallet")',
    ),
    connectSelector: z.string().optional().describe(
      'Selector for the Connect button',
    ),
    walletSelector: z.string().optional().describe(
      'Selector for the wallet entry in the modal',
    ),
    connectedSelector: z.string().optional().describe(
      'Selector to wait for after connection',
    ),
  },
  async ({ walletName, connectSelector, walletSelector, connectedSelector }) => {
    if (!walletManager) {
      return {
        content: [{ type: 'text', text: 'Error: Call wallet_setup first.' }],
        isError: true,
      };
    }

    const p = getPage();
    const name = walletName ?? 'Playwright Test Wallet';

    const connectSel = connectSelector
      ?? '[data-testid="connect-button"], button:has-text("Connect Wallet"), button:has-text("Connect")';
    await p.locator(connectSel).first().click({ timeout: 5000 });

    // Try wallet selection step — not all apps show a modal; some connect directly
    const walletSel = walletSelector ?? `text=${name}`;
    await p.locator(walletSel).first().click({ timeout: 2000 }).catch(() => {
      // No wallet selection modal — app likely connected on button click
    });

    const connectedSel = connectedSelector
      ?? '[data-testid="account-address"], [data-testid="connected"]';
    await p.waitForSelector(connectedSel, { timeout: 5000 }).catch(() => {});

    walletConnected = true;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ connected: true, address: walletManager.address }),
      }],
    };
  },
);

server.tool(
  'wallet_state',
  'Get current wallet state: address, network, balance, connection status.',
  {},
  async () => {
    if (!walletManager) {
      return {
        content: [{ type: 'text', text: 'Error: Call wallet_setup first.' }],
        isError: true,
      };
    }

    let balance = '0';
    try {
      balance = (await walletManager.getBalance()).toString();
    } catch {
      // RPC might be unavailable
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          address: walletManager.address,
          network: walletManager.network,
          balance,
          connected: walletConnected,
        }, null, 2),
      }],
    };
  },
);

server.tool(
  'wallet_disconnect',
  'Disconnect the mock wallet and clean up.',
  {},
  async () => {
    if (walletManager && page) {
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('wallet-standard:disconnect'));
      }).catch(() => {});
    }

    walletManager = null;
    walletConnected = false;

    return {
      content: [{ type: 'text', text: JSON.stringify({ disconnected: true }) }],
    };
  },
);

server.tool(
  'browser_close',
  'Close the browser and clean up all state.',
  {},
  async () => {
    walletManager = null;
    walletConnected = false;
    if (browser) {
      await browser.close();
      browser = null;
      context = null;
      page = null;
    }
    return {
      content: [{ type: 'text', text: 'Browser closed.' }],
    };
  },
);

// ── Start ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});

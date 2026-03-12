import type { Page } from '@playwright/test';
import type { SuiNetwork } from '../wallet/types.js';
import {
  createInitialState,
  walletSetupSchema,
  walletSetupHandler,
  walletConnectSchema,
  walletConnectHandler,
  walletStateSchema,
  walletStateHandler,
  walletDisconnectSchema,
  walletDisconnectHandler,
} from './tools.js';

/**
 * Options for registerWalletTools when using the options-object form.
 */
export interface RegisterWalletToolsOptions {
  /** Function that returns the current Playwright Page. */
  getPage: () => Page;
  /** Default dApp URL — passed to wallet_setup for auto-navigation. */
  dappUrl?: string;
  /** Default Sui network for wallet_setup. */
  defaultNetwork?: SuiNetwork;
}

/**
 * Register all wallet MCP tools with an MCP server instance.
 *
 * @param server - An MCP server with a `tool(name, schema, handler)` method.
 *                 Compatible with @modelcontextprotocol/sdk's McpServer.
 * @param getPageOrOptions - Either a function returning the current Page,
 *                           or an options object with getPage + defaults.
 *
 * @example
 * ```typescript
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 * import { registerWalletTools } from 'sui-playwright-wallet/mcp';
 *
 * // Simple: just pass a getPage callback
 * registerWalletTools(server, () => currentPage);
 *
 * // With options: auto-navigate + default network
 * registerWalletTools(server, {
 *   getPage: () => currentPage,
 *   dappUrl: 'http://localhost:5173',
 *   defaultNetwork: 'localnet',
 * });
 * ```
 */
export function registerWalletTools(
  server: McpServerLike,
  getPageOrOptions: (() => Page) | RegisterWalletToolsOptions,
): void {
  const getPage = typeof getPageOrOptions === 'function'
    ? getPageOrOptions
    : getPageOrOptions.getPage;
  const options = typeof getPageOrOptions === 'function'
    ? undefined
    : getPageOrOptions;

  const state = createInitialState();

  server.tool(
    walletSetupSchema.name,
    walletSetupSchema.description,
    walletSetupSchema.inputSchema,
    walletSetupHandler(getPage, state, options ? { dappUrl: options.dappUrl } : undefined),
  );

  server.tool(
    walletConnectSchema.name,
    walletConnectSchema.description,
    walletConnectSchema.inputSchema,
    walletConnectHandler(getPage, state),
  );

  server.tool(
    walletStateSchema.name,
    walletStateSchema.description,
    walletStateSchema.inputSchema,
    walletStateHandler(getPage, state),
  );

  server.tool(
    walletDisconnectSchema.name,
    walletDisconnectSchema.description,
    walletDisconnectSchema.inputSchema,
    walletDisconnectHandler(getPage, state),
  );
}

/**
 * Minimal interface for an MCP server that supports tool registration.
 * Compatible with @modelcontextprotocol/sdk's McpServer.tool() overload.
 */
export interface McpServerLike {
  tool(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: (input: Record<string, unknown>) => Promise<unknown>,
  ): void;
}

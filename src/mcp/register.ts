import type { Page } from '@playwright/test';
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
 * Register all wallet MCP tools with an MCP server instance.
 *
 * @param server - An MCP server with a `tool(name, schema, handler)` method.
 *                 Compatible with @modelcontextprotocol/sdk's McpServer.
 * @param getPage - Function that returns the current Playwright Page.
 *                  Called lazily when a tool is invoked, so the page
 *                  can change between calls (e.g. after navigation).
 *
 * @example
 * ```typescript
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 * import { registerWalletTools } from 'sui-playwright-wallet';
 *
 * const server = new McpServer({ name: 'my-server', version: '1.0.0' });
 * registerWalletTools(server, () => currentPage);
 * ```
 */
export function registerWalletTools(
  server: McpServerLike,
  getPage: () => Page,
): void {
  const state = createInitialState();

  server.tool(
    walletSetupSchema.name,
    walletSetupSchema.description,
    walletSetupSchema.inputSchema,
    walletSetupHandler(getPage, state),
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

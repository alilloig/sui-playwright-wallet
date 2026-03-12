// Core
export { WalletManager } from './wallet/manager.js';
export { buildInjectScript } from './wallet/inject.js';
export type {
  WalletConfig,
  SuiNetwork,
  AccountInfo,
  WalletState,
  InjectConfig,
  InjectedPage,
} from './wallet/types.js';
export { NETWORK_URLS, LOCALNET_FAUCET_URL } from './wallet/types.js';

// MCP tools
export { registerWalletTools } from './mcp/register.js';
export type { McpServerLike, RegisterWalletToolsOptions } from './mcp/register.js';
export {
  walletSetupSchema,
  walletSetupHandler,
  walletConnectSchema,
  walletConnectHandler,
  walletStateSchema,
  walletStateHandler,
  walletDisconnectSchema,
  walletDisconnectHandler,
  createInitialState,
} from './mcp/tools.js';
export type { WalletMcpState, WalletSetupHandlerOptions } from './mcp/tools.js';

// Playwright helpers (fixtures are a separate entry point)
export {
  waitForWalletReady,
  clickConnect,
  waitForConnected,
  isConnected,
  clickDisconnect,
  getInjectedWalletInfo,
} from './playwright/helpers.js';
export type { ClickConnectOptions } from './playwright/helpers.js';

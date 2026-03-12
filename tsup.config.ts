import { defineConfig } from 'tsup';

export default defineConfig([
  // Library build (index + fixtures)
  {
    entry: {
      index: 'src/index.ts',
      'playwright/fixtures': 'src/playwright/fixtures.ts',
      'mcp/register': 'src/mcp/register.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node18',
    external: ['@playwright/test', '@modelcontextprotocol/sdk'],
  },
  // MCP server build (standalone executable, all deps bundled except playwright)
  {
    entry: {
      'mcp/server': 'src/mcp/server.ts',
    },
    format: ['esm'],
    sourcemap: true,
    target: 'node18',
    // Bundle MCP SDK + Sui SDK into the server so it runs standalone.
    // Only playwright (must match the user's installed version) stays external.
    noExternal: [/@modelcontextprotocol/, /@mysten/, /zod/, /yaml/],
    external: ['playwright'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);

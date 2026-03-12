import { describe, it, expect, vi } from 'vitest';
import { registerWalletTools } from '../../src/mcp/register.js';
import type { McpServerLike } from '../../src/mcp/register.js';
import type { Page } from '@playwright/test';

const mockPage = {} as Page;
const getPage = () => mockPage;

function createMockServer() {
  const tools: Array<{ name: string; description: string; schema: Record<string, unknown> }> = [];
  const server: McpServerLike = {
    tool: vi.fn((name, description, schema) => {
      tools.push({ name, description, schema });
    }),
  };
  return { server, tools };
}

describe('registerWalletTools', () => {
  describe('function form (getPage callback)', () => {
    it('registers all 4 wallet tools', () => {
      const { server, tools } = createMockServer();
      registerWalletTools(server, getPage);

      expect(tools).toHaveLength(4);
      expect(tools.map((t) => t.name)).toEqual([
        'wallet_setup',
        'wallet_connect',
        'wallet_state',
        'wallet_disconnect',
      ]);
    });

    it('calls server.tool with name, description, schema, and handler', () => {
      const { server } = createMockServer();
      registerWalletTools(server, getPage);

      expect(server.tool).toHaveBeenCalledTimes(4);
      for (const call of (server.tool as ReturnType<typeof vi.fn>).mock.calls) {
        expect(call).toHaveLength(4);
        expect(typeof call[0]).toBe('string'); // name
        expect(typeof call[1]).toBe('string'); // description
        expect(typeof call[2]).toBe('object'); // schema
        expect(typeof call[3]).toBe('function'); // handler
      }
    });
  });

  describe('options object form', () => {
    it('registers all 4 wallet tools with options object', () => {
      const { server, tools } = createMockServer();
      registerWalletTools(server, { getPage });

      expect(tools).toHaveLength(4);
      expect(tools.map((t) => t.name)).toEqual([
        'wallet_setup',
        'wallet_connect',
        'wallet_state',
        'wallet_disconnect',
      ]);
    });

    it('accepts dappUrl option', () => {
      const { server, tools } = createMockServer();
      registerWalletTools(server, {
        getPage,
        dappUrl: 'http://localhost:5173',
      });

      expect(tools).toHaveLength(4);
    });

    it('accepts defaultNetwork option', () => {
      const { server, tools } = createMockServer();
      registerWalletTools(server, {
        getPage,
        defaultNetwork: 'testnet',
      });

      expect(tools).toHaveLength(4);
    });

    it('accepts all options together', () => {
      const { server, tools } = createMockServer();
      registerWalletTools(server, {
        getPage,
        dappUrl: 'http://localhost:5173',
        defaultNetwork: 'devnet',
      });

      expect(tools).toHaveLength(4);
    });
  });

  describe('McpServerLike interface compatibility', () => {
    it('works with a minimal server implementation', () => {
      const server: McpServerLike = {
        tool: () => {},
      };
      // Should not throw
      registerWalletTools(server, getPage);
    });
  });
});

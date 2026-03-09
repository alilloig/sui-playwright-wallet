import { describe, it, expect } from 'vitest';
import {
  walletSetupSchema,
  walletConnectSchema,
  walletStateSchema,
  walletDisconnectSchema,
  walletConnectHandler,
  walletStateHandler,
  walletDisconnectHandler,
  createInitialState,
} from '../../src/mcp/tools.js';
import type { Page } from '@playwright/test';

const mockPage = {} as Page;
const getPage = () => mockPage;

describe('MCP tool schemas', () => {
  it('defines expected tool names', () => {
    expect(walletSetupSchema.name).toBe('wallet_setup');
    expect(walletConnectSchema.name).toBe('wallet_connect');
    expect(walletStateSchema.name).toBe('wallet_state');
    expect(walletDisconnectSchema.name).toBe('wallet_disconnect');
  });
});

describe('createInitialState', () => {
  it('returns state with null manager and disconnected', () => {
    const state = createInitialState();
    expect(state).toEqual({ manager: null, connected: false });
  });
});

describe('walletConnectHandler', () => {
  it('returns error when manager is null', async () => {
    const state = createInitialState();
    const handler = walletConnectHandler(getPage, state);
    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });
});

describe('walletStateHandler', () => {
  it('returns error when manager is null', async () => {
    const state = createInitialState();
    const handler = walletStateHandler(getPage, state);
    const result = await handler();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });
});

describe('walletDisconnectHandler', () => {
  it('returns disconnected: true even without manager', async () => {
    const state = createInitialState();
    const handler = walletDisconnectHandler(getPage, state);
    const result = await handler();
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.disconnected).toBe(true);
  });
});

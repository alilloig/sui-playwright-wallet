import type { InjectConfig } from './types.js';

/**
 * Builds a self-contained JavaScript string that, when evaluated in a browser,
 * registers a mock Sui wallet with the Wallet Standard registry.
 *
 * The script delegates all signing operations to Node.js bridge functions
 * previously exposed via page.exposeFunction(). The private key never touches
 * the browser.
 *
 * Registration uses the same bidirectional event protocol as @wallet-standard/core:
 *   1. Listen for 'wallet-standard:app-ready' (handles dApp Kit loading after us)
 *   2. Dispatch 'wallet-standard:register-wallet' (handles dApp Kit already loaded)
 */
export function buildInjectScript(config: InjectConfig): string {
  // Escape values for safe interpolation into the script string
  const address = config.address.replace(/'/g, "\\'");
  const publicKey = config.publicKey.replace(/'/g, "\\'");
  const chain = config.chain.replace(/'/g, "\\'");

  return `(function() {
  'use strict';

  // --- Helpers ---

  function uint8ArrayToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToUint8Array(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Resolve a transaction input to a base64 string.
  // dApp Kit v2 passes a wrapper object with a toJSON() method
  // that returns the base64-encoded built transaction bytes.
  // Raw strings and Uint8Arrays are also handled for compatibility.
  function resolveTransactionToBase64(transaction) {
    if (typeof transaction === 'string') {
      return Promise.resolve(transaction);
    }
    if (transaction instanceof Uint8Array) {
      return Promise.resolve(uint8ArrayToBase64(transaction));
    }
    if (transaction && typeof transaction.toJSON === 'function') {
      return Promise.resolve(transaction.toJSON()).then(function(result) {
        if (typeof result === 'string') return result;
        if (result instanceof Uint8Array) return uint8ArrayToBase64(result);
        return uint8ArrayToBase64(new Uint8Array(result));
      });
    }
    // Fallback: try to treat as array-like
    return Promise.resolve(uint8ArrayToBase64(new Uint8Array(transaction)));
  }

  // --- Account ---

  var publicKeyBytes = base64ToUint8Array('${publicKey}');

  var account = {
    address: '${address}',
    publicKey: publicKeyBytes,
    chains: ['sui:${chain}'],
    features: [
      'sui:signTransaction',
      'sui:signAndExecuteTransaction',
      'sui:signPersonalMessage',
    ],
  };

  // --- Event emitter for standard:events ---

  var eventListeners = [];

  function emitChange(changes) {
    for (var i = 0; i < eventListeners.length; i++) {
      try { eventListeners[i](changes); } catch (e) { console.error('[pw-wallet] event listener error:', e); }
    }
  }

  // --- Connected state ---

  var connected = false;
  var currentAccounts = [];

  // --- Mock Wallet ---

  var wallet = {
    version: '1.0.0',
    name: 'Playwright Test Wallet',
    icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="%232563eb"/><text x="32" y="40" font-size="28" text-anchor="middle" fill="white" font-family="sans-serif">PW</text></svg>'),
    chains: ['sui:${chain}'],

    get accounts() {
      return currentAccounts;
    },

    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: function() {
          connected = true;
          currentAccounts = [account];
          emitChange({ accounts: currentAccounts });
          console.log('[pw-wallet] Connected:', '${address}');
          return Promise.resolve({ accounts: [account] });
        },
      },

      'standard:disconnect': {
        version: '1.0.0',
        disconnect: function() {
          connected = false;
          currentAccounts = [];
          emitChange({ accounts: [] });
          console.log('[pw-wallet] Disconnected');
          return Promise.resolve();
        },
      },

      'standard:events': {
        version: '1.0.0',
        on: function(event, callback) {
          if (event === 'change') {
            eventListeners.push(callback);
            return function() {
              var idx = eventListeners.indexOf(callback);
              if (idx !== -1) eventListeners.splice(idx, 1);
            };
          }
          return function() {};
        },
      },

      'sui:signTransaction': {
        version: '2.0.0',
        signTransaction: function(input) {
          return resolveTransactionToBase64(input.transaction).then(function(txData) {
            return window.__pw_wallet_sign_tx(txData).then(function(resultJson) {
              var result = JSON.parse(resultJson);
              return {
                bytes: result.bytes,
                signature: result.signature,
              };
            });
          });
        },
      },

      'sui:signAndExecuteTransaction': {
        version: '2.0.0',
        signAndExecuteTransaction: function(input) {
          return resolveTransactionToBase64(input.transaction).then(function(txBase64) {
            return window.__pw_wallet_sign_and_exec(txBase64).then(function(resultJson) {
              return JSON.parse(resultJson);
            });
          });
        },
      },

      'sui:signPersonalMessage': {
        version: '1.1.0',
        signPersonalMessage: function(input) {
          var message = input.message;
          var msgBase64 = uint8ArrayToBase64(new Uint8Array(message));

          return window.__pw_wallet_sign_msg(msgBase64).then(function(sigBase64) {
            return {
              bytes: msgBase64,
              signature: sigBase64,
            };
          });
        },
      },
    },
  };

  // --- Wallet Standard Registration (bidirectional event protocol) ---

  // The callback that registers our wallet when given a register function
  var registrationCallback = function(api) {
    if (api && typeof api.register === 'function') {
      api.register(wallet);
    }
  };

  // Phase 1: Listen for 'wallet-standard:app-ready'
  // This handles the case where dApp Kit initializes AFTER our script runs.
  // When dApp Kit calls getWallets(), it dispatches this event with { register }.
  window.addEventListener('wallet-standard:app-ready', function(event) {
    registrationCallback(event.detail);
  });

  // Phase 2: Dispatch 'wallet-standard:register-wallet'
  // This handles the case where dApp Kit already initialized BEFORE our script.
  // dApp Kit's getWallets() listens for this event and calls the callback
  // with { register }.
  try {
    window.dispatchEvent(
      new CustomEvent('wallet-standard:register-wallet', {
        detail: registrationCallback,
      })
    );
  } catch (e) {
    console.error('[pw-wallet] Failed to dispatch register-wallet event:', e);
  }

  // Mark injection as complete for test assertions
  window.__pw_wallet_injected = true;
  window.__pw_wallet_info = { address: '${address}', chain: 'sui:${chain}' };

  console.log('[pw-wallet] Mock Sui wallet registered:',
    '${address}', 'on sui:${chain}');
})();`;
}

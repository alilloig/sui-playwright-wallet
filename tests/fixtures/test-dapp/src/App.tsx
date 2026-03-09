import { useState } from 'react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Transaction } from '@mysten/sui/transactions';
import { useMutation } from '@tanstack/react-query';

export function App() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [txResult, setTxResult] = useState<string | null>(null);
  const [msgResult, setMsgResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { mutate: signAndExecute, isPending: isTxPending } = useMutation({
    mutationFn: async () => {
      const tx = new Transaction();
      // Split 1000 MIST from gas and transfer to self (no-op but exercises signing)
      const [coin] = tx.splitCoins(tx.gas, [1000]);
      tx.transferObjects([coin], account!.address);

      const result = await dAppKit.signAndExecuteTransaction({
        transaction: tx,
      });

      if (result.$kind === 'FailedTransaction') {
        throw new Error('Transaction failed');
      }

      return result;
    },
    onSuccess: (result) => {
      setTxResult(JSON.stringify(result, null, 2));
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
      setTxResult(null);
    },
  });

  const { mutate: signMessage, isPending: isMsgPending } = useMutation({
    mutationFn: async () => {
      const message = new TextEncoder().encode('Hello from Playwright Test Wallet!');
      return await dAppKit.signPersonalMessage({ message });
    },
    onSuccess: (result) => {
      setMsgResult(JSON.stringify(result, null, 2));
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
      setMsgResult(null);
    },
  });

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Sui Playwright Wallet — Test dApp</h1>

      <div style={{ marginBottom: '1rem' }}>
        <ConnectButton data-testid="connect-button" />
      </div>

      {account && (
        <div>
          <p>
            Connected as:{' '}
            <code data-testid="account-address">{account.address}</code>
          </p>

          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <button
              data-testid="sign-tx-button"
              onClick={() => signAndExecute()}
              disabled={isTxPending}
            >
              {isTxPending ? 'Signing...' : 'Sign & Execute Transaction'}
            </button>

            <button
              data-testid="sign-msg-button"
              onClick={() => signMessage()}
              disabled={isMsgPending}
            >
              {isMsgPending ? 'Signing...' : 'Sign Personal Message'}
            </button>
          </div>

          {txResult && (
            <div data-testid="tx-result">
              <h3>Transaction Result:</h3>
              <pre style={{ background: '#f5f5f5', padding: '1rem', overflow: 'auto' }}>
                {txResult}
              </pre>
            </div>
          )}

          {msgResult && (
            <div data-testid="msg-result">
              <h3>Message Signature:</h3>
              <pre style={{ background: '#f5f5f5', padding: '1rem', overflow: 'auto' }}>
                {msgResult}
              </pre>
            </div>
          )}

          {error && (
            <div data-testid="error" style={{ color: 'red' }}>
              <h3>Error:</h3>
              <pre>{error}</pre>
            </div>
          )}
        </div>
      )}

      {!account && (
        <p data-testid="disconnected-state">
          Click &quot;Connect Wallet&quot; to start testing.
        </p>
      )}
    </div>
  );
}

import { useState } from 'react';
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSignPersonalMessage,
} from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';

export function App() {
  const account = useCurrentAccount();
  const { mutate: signAndExecute, isPending: isTxPending } =
    useSignAndExecuteTransaction();
  const { mutate: signMessage, isPending: isMsgPending } =
    useSignPersonalMessage();

  const [txResult, setTxResult] = useState<string | null>(null);
  const [msgResult, setMsgResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSignTx = () => {
    setError(null);
    setTxResult(null);

    const tx = new Transaction();
    // Split 1000 MIST from gas and transfer to self (no-op but exercises signing)
    const [coin] = tx.splitCoins(tx.gas, [1000]);
    tx.transferObjects([coin], account!.address);

    signAndExecute(
      { transaction: tx },
      {
        onSuccess: (result) => {
          setTxResult(JSON.stringify(result, null, 2));
        },
        onError: (err) => {
          setError(err.message);
        },
      },
    );
  };

  const handleSignMessage = () => {
    setError(null);
    setMsgResult(null);

    const message = new TextEncoder().encode('Hello from Playwright Test Wallet!');

    signMessage(
      { message },
      {
        onSuccess: (result) => {
          setMsgResult(JSON.stringify(result, null, 2));
        },
        onError: (err) => {
          setError(err.message);
        },
      },
    );
  };

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
              onClick={handleSignTx}
              disabled={isTxPending}
            >
              {isTxPending ? 'Signing...' : 'Sign & Execute Transaction'}
            </button>

            <button
              data-testid="sign-msg-button"
              onClick={handleSignMessage}
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

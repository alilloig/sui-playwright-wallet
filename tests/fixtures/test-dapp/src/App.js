import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Transaction } from '@mysten/sui/transactions';
import { useMutation } from '@tanstack/react-query';
export function App() {
    const account = useCurrentAccount();
    const dAppKit = useDAppKit();
    const [txResult, setTxResult] = useState(null);
    const [msgResult, setMsgResult] = useState(null);
    const [error, setError] = useState(null);
    const { mutate: signAndExecute, isPending: isTxPending } = useMutation({
        mutationFn: async () => {
            const tx = new Transaction();
            // Split 1000 MIST from gas and transfer to self (no-op but exercises signing)
            const [coin] = tx.splitCoins(tx.gas, [1000]);
            tx.transferObjects([coin], account.address);
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
        onError: (err) => {
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
        onError: (err) => {
            setError(err.message);
            setMsgResult(null);
        },
    });
    return (_jsxs("div", { style: { padding: '2rem', fontFamily: 'system-ui, sans-serif' }, children: [_jsx("h1", { children: "Sui Playwright Wallet \u2014 Test dApp" }), _jsx("div", { style: { marginBottom: '1rem' }, children: _jsx(ConnectButton, { "data-testid": "connect-button" }) }), account && (_jsxs("div", { children: [_jsxs("p", { children: ["Connected as:", ' ', _jsx("code", { "data-testid": "account-address", children: account.address })] }), _jsxs("div", { style: { display: 'flex', gap: '1rem', marginBottom: '1rem' }, children: [_jsx("button", { "data-testid": "sign-tx-button", onClick: () => signAndExecute(), disabled: isTxPending, children: isTxPending ? 'Signing...' : 'Sign & Execute Transaction' }), _jsx("button", { "data-testid": "sign-msg-button", onClick: () => signMessage(), disabled: isMsgPending, children: isMsgPending ? 'Signing...' : 'Sign Personal Message' })] }), txResult && (_jsxs("div", { "data-testid": "tx-result", children: [_jsx("h3", { children: "Transaction Result:" }), _jsx("pre", { style: { background: '#f5f5f5', padding: '1rem', overflow: 'auto' }, children: txResult })] })), msgResult && (_jsxs("div", { "data-testid": "msg-result", children: [_jsx("h3", { children: "Message Signature:" }), _jsx("pre", { style: { background: '#f5f5f5', padding: '1rem', overflow: 'auto' }, children: msgResult })] })), error && (_jsxs("div", { "data-testid": "error", style: { color: 'red' }, children: [_jsx("h3", { children: "Error:" }), _jsx("pre", { children: error })] }))] })), !account && (_jsx("p", { "data-testid": "disconnected-state", children: "Click \"Connect Wallet\" to start testing." }))] }));
}

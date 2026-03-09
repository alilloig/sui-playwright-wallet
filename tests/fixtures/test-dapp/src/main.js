import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createDAppKit, DAppKitProvider } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { App } from './App';
const queryClient = new QueryClient();
const NETWORK_URLS = {
    localnet: 'http://127.0.0.1:9000',
    testnet: 'https://fullnode.testnet.sui.io:443',
    devnet: 'https://fullnode.devnet.sui.io:443',
};
const dAppKit = createDAppKit({
    networks: ['localnet', 'testnet', 'devnet'],
    defaultNetwork: 'localnet',
    createClient(network) {
        return new SuiGrpcClient({
            network,
            baseUrl: NETWORK_URLS[network],
        });
    },
});
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(QueryClientProvider, { client: queryClient, children: _jsx(DAppKitProvider, { dAppKit: dAppKit, children: _jsx(App, {}) }) }) }));

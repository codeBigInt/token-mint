import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { MidnightMeshProvider } from '@meshsdk/midnight-react';
// import "@meshsdk/midnight-react/styles.css";
import * as pino from "pino";
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import TokenMintDeployedContractProvider from './context/TokenMintDeployedContractProvider.tsx';

const networkId = import.meta.env.VITE_NETWORK_ID as NetworkId;
// Ensure that the network IDs are set within the Midnight libraries.
setNetworkId(networkId);

// Create a default `pino` logger and configure it with the configured logging level.
export const logger = pino.pino({
  level: import.meta.env.VITE_LOGGING_LEVEL as string,
});

logger.trace('networkId = ', networkId);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MidnightMeshProvider logger={logger}>
      <TokenMintDeployedContractProvider logger={logger}>
        <App />
      </TokenMintDeployedContractProvider>
    </MidnightMeshProvider>
  </StrictMode>,
)

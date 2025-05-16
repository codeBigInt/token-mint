import React, { createContext } from 'react'
import { BrowserDeplyedTokenMintContractManager, type DeployedTokenMintProvider } from './BrowserDeployedTokenMntManager';
import type { Logger } from 'pino';

export const TokenMintContext = createContext<DeployedTokenMintProvider | undefined>(undefined);

const TokenMintDeployedContractProvider = ({ children, logger }: { children: React.ReactNode, logger: Logger }) => {
    return (
        <TokenMintContext.Provider value={new BrowserDeplyedTokenMintContractManager(logger)}>
            {children}
        </TokenMintContext.Provider>
    )
}

export default TokenMintDeployedContractProvider

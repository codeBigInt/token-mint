import type { Logger } from "pino";
import {
    BehaviorSubject,
    type Observable,
    concatMap,
    filter,
    firstValueFrom,
    interval,
    map,
    of,
    take,
    tap,
    throwError,
    timeout,
    catchError,
} from 'rxjs';
import semver from 'semver';
import { pipe as fnPipe } from 'fp-ts/function';
import { TokenMintAPI, type TokenMintContractProviders, type DeployedTokenMintAPI } from "@token-mint/token-mint-api"
import type { ContractAddress, CoinInfo } from "@midnight-ntwrk/compact-runtime";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { createBalancedTx, type BalancedTransaction, type UnbalancedTransaction } from "@midnight-ntwrk/midnight-js-types";
import { getLedgerNetworkId, getZswapNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { Transaction, type TransactionId } from "@midnight-ntwrk/ledger";
import { Transaction as ZswapTransaction } from '@midnight-ntwrk/zswap';
import type { DAppConnectorAPI, DAppConnectorWalletAPI, ServiceUriConfig } from "@midnight-ntwrk/dapp-connector-api";


export interface InActiveTokenMintDeployment {
    readonly status: "inactive"
}
export interface InProgressTokenMintDeployment {
    readonly status: "in-progress";
}

export interface DeployedTokenMintDeployment {
    readonly status: "deployed";
    readonly api: DeployedTokenMintAPI;
}

export interface FailedTokenMintDeployment {
    readonly status: "failed";
    readonly error: Error;
}

export type TokenMintDeployment = InActiveTokenMintDeployment | InProgressTokenMintDeployment | FailedTokenMintDeployment | DeployedTokenMintDeployment;

export interface DeployedTokenMintProvider {
    readonly tokenMintDeployment$: Observable<TokenMintDeployment>;
    readonly resolve: (contractAddress?: ContractAddress) => Observable<TokenMintDeployment>;
}

export class BrowserDeplyedTokenMintContractManager implements DeployedTokenMintProvider {
    readonly tokenMintDeployment$: Observable<TokenMintDeployment>;
    #initializedProviders: Promise<TokenMintContractProviders> | undefined;
    private readonly logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
        this.tokenMintDeployment$ = new BehaviorSubject<TokenMintDeployment>({ status: "inactive" });
    }

    resolve(contractAddress?: ContractAddress): Observable<TokenMintDeployment> {
        let deployment = new BehaviorSubject<TokenMintDeployment>({ status: "in-progress" })

        if (contractAddress) {
            void this.joinDeployment(deployment, contractAddress);
        } else {
            void this.deployDeployment(deployment);
        }

        return deployment;

    }
    public async joinDeployment(
        deployment: BehaviorSubject<TokenMintDeployment>,
        contractAddress: ContractAddress): Promise<void> {
        try {
            this.logger?.info("Started deployment");
            const providers = await this.getProviders();
            const api = await TokenMintAPI.joinTokenMintContract(providers, contractAddress, this.logger)

            this.logger?.trace({
                joinedContractData: {
                    contractAddress: api.deployedContractAddress,
                    state: api.state
                }
            });

            deployment.next({
                status: "deployed",
                api: api
            })

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : "Failed to join contract"
            this.logger?.info(errMsg)
            deployment.next({
                status: "failed",
                error: error instanceof Error ? error : new Error(String(error))
            })
        }
    }
    public async deployDeployment(deployment: BehaviorSubject<TokenMintDeployment>) {
        try {
            this.logger?.info("Started new deployment");
            const providers = await this.getProviders();
            const api = await TokenMintAPI.deployTokenMintContract(providers, this.logger)

            this.logger?.trace({
                newDeployedContractData: {
                    contractAddress: api.deployedContractAddress,
                    state: api.state
                }
            });

            deployment.next({
                status: "deployed",
                api: api
            })
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : "Failed to join contract"
            this.logger?.info(errMsg)
            deployment.next({
                status: "failed",
                error: error instanceof Error ? error : new Error(String(error))
            })
        }
    }

    private getProviders(): Promise<TokenMintContractProviders> {
        return this.#initializedProviders ?? (this.#initializedProviders = initializeProviders(this.logger));
    }
}


/** @internal */
const initializeProviders = async (logger: Logger): Promise<TokenMintContractProviders> => {
    const { wallet, uris } = await connectToWallet(logger);
    const walletState = await wallet.state();

    return {
        privateStateProvider:  levelPrivateStateProvider({
            privateStateStoreName: 'token-private-state',
        }),
        zkConfigProvider: new FetchZkConfigProvider(window.location.origin, fetch.bind(window)),
        proofProvider: httpClientProofProvider(uris.proverServerUri),
        publicDataProvider: indexerPublicDataProvider(uris.indexerUri, uris.indexerWsUri),
        walletProvider: {
            coinPublicKey: walletState.coinPublicKey,
            balanceTx(tx: UnbalancedTransaction, newCoins: CoinInfo[]): Promise<BalancedTransaction> {
                return wallet
                    .balanceAndProveTransaction(
                        ZswapTransaction.deserialize(tx.serialize(getLedgerNetworkId()), getZswapNetworkId()),
                        newCoins,
                    )
                    .then((zswapTx) => Transaction.deserialize(zswapTx.serialize(getZswapNetworkId()), getLedgerNetworkId()))
                    .then(createBalancedTx);
            },
        },
        midnightProvider: {
            submitTx(tx: BalancedTransaction): Promise<TransactionId> {
                return wallet.submitTransaction(tx);
            },
        },
    };
};

/** @internal */
const connectToWallet = (logger: Logger): Promise<{ wallet: DAppConnectorWalletAPI; uris: ServiceUriConfig }> => {
    const COMPATIBLE_CONNECTOR_API_VERSION = '1.x';

    return firstValueFrom(
        fnPipe(
            interval(100),
            map(() => window.midnight?.mnLace),
            tap((connectorAPI) => {
                logger.info(connectorAPI, 'Check for wallet connector API');
            }),
            filter((connectorAPI): connectorAPI is DAppConnectorAPI => !!connectorAPI),
            concatMap((connectorAPI) =>
                semver.satisfies(connectorAPI.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION)
                    ? of(connectorAPI)
                    : throwError(() => {
                        logger.error(
                            {
                                expected: COMPATIBLE_CONNECTOR_API_VERSION,
                                actual: connectorAPI.apiVersion,
                            },
                            'Incompatible version of wallet connector API',
                        );

                        return new Error(
                            `Incompatible version of Midnight Lace wallet found. Require '${COMPATIBLE_CONNECTOR_API_VERSION}', got '${connectorAPI.apiVersion}'.`,
                        );
                    }),
            ),
            tap((connectorAPI) => {
                logger.info(connectorAPI, 'Compatible wallet connector API found. Connecting.');
            }),
            take(1),
            timeout({
                first: 1_000,
                with: () =>
                    throwError(() => {
                        logger.error('Could not find wallet connector API');

                        return new Error('Could not find Midnight Lace wallet. Extension installed?');
                    }),
            }),
            concatMap(async (connectorAPI) => {
                const isEnabled = await connectorAPI.isEnabled();

                logger.info(isEnabled, 'Wallet connector API enabled status');

                return connectorAPI;
            }),
            timeout({
                first: 5_000,
                with: () =>
                    throwError(() => {
                        logger.error('Wallet connector API has failed to respond');

                        return new Error('Midnight Lace wallet has failed to respond. Extension enabled?');
                    }),
            }),
            concatMap(async (connectorAPI) => ({ walletConnectorAPI: await connectorAPI.enable(), connectorAPI })),
            catchError((error, apis) =>
                error
                    ? throwError(() => {
                        logger.error('Unable to enable connector API');
                        return new Error('Application is not authorized');
                    })
                    : apis,
            ),
            concatMap(async ({ walletConnectorAPI, connectorAPI }) => {
                const uris = await connectorAPI.serviceUriConfig();

                logger.info('Connected to wallet connector API and retrieved service configuration');

                return { wallet: walletConnectorAPI, uris };
            }),
        ),
    );
};

import { webcrypto } from "crypto";
import { WebSocket } from "ws"
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { stdin as input, stdout as output } from 'node:process';
import { DeployedTokenMintOnchainContract, DerivedTokenMintContractState, TokenMintAPI, TokenMintContractProviders, utils } from "@token-mint/token-mint-api"
import { ContractAddress } from "@midnight-ntwrk/compact-runtime";
import { createInterface, Interface } from "node:readline/promises";
import { Logger } from "pino";
import {type Ledger, ledger} from "@token-mint/token-mint-contract"
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { type Config, StandaloneConfig } from './config.js';
import { getLedgerNetworkId, getZswapNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as Rx from 'rxjs';
import type { StartedDockerComposeEnvironment, DockerComposeEnvironment } from 'testcontainers';
import { type Resource, WalletBuilder } from '@midnight-ntwrk/wallet';
import { Transaction as ZswapTransaction } from '@midnight-ntwrk/zswap';
import { type Wallet } from '@midnight-ntwrk/wallet-api';
import { nativeToken, Transaction, type CoinInfo, type TransactionId } from "@midnight-ntwrk/ledger";
import { type MidnightProvider, type WalletProvider, type UnbalancedTransaction, createBalancedTx, type BalancedTransaction, PrivateStateId } from "@midnight-ntwrk/midnight-js-types";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
// @ts-expect-error: It allows Scala.js & WASM code be able to use crypto
globalThis.crypto = webcrypto

// @ts-expect-error: enables Websocket usage
globalThis.WebSocket = WebSocket

/**
 * publicDataProvider is used because it allows us retrieve ledger state variables
 * @param providers provides us with all api to interact with midnight blockchain
 * enable us read or update the state of our smart contract
 * @param contractAddress the address of the intend smart contract we intend to retrieve the state of.
 * @returns the state of our smart contract
 */
export const getTokenMintLedgerState = (
    providers: TokenMintContractProviders,
    contractAddress: ContractAddress
): Promise<Ledger | null> =>
    providers.publicDataProvider
        .queryContractState(contractAddress)
        .then((contractState) => (contractState != null ? ledger(contractState.data) : null))

const DEPLOY_OR_JOIN_QUESTION = `
    You can do one of the following:
    1. Deploy a new lucky token mint contract
    2. Join an existing one
    3. Exit
`

const resolve = async (providers: TokenMintContractProviders, rli: Interface, logger: Logger): Promise<TokenMintAPI | null> => {
    let api: TokenMintAPI | null = null;

    while (true) {
        const choice = await rli.question(DEPLOY_OR_JOIN_QUESTION);
        switch (choice) {
            case "1":
                api = await TokenMintAPI.deployTokenMintContract(providers, logger);
                logger.info(`Deployed contract at address: ${api.deployedContractAddress}`);
                return api;

            case "2":
                api = await TokenMintAPI.joinTokenMintContract(providers, await rli.question("What is the contract address (in hex)?"), logger);
                logger.info(`Joined contract at address: ${api.deployedContractAddress}`);
                return api;
        }
    }
}

const displayLedgerState = async (providers: TokenMintContractProviders, deployedTokenMintContract: DeployedTokenMintOnchainContract, logger: Logger): Promise<void> => {
    const contractAddress = deployedTokenMintContract.deployTxData.public.contractAddress;
    const ledgerState = await getTokenMintLedgerState(providers, contractAddress);
    if (ledgerState === null) {
        logger.info(`There is no token mint contract deployed at ${contractAddress}`);
    } else {
        logger.info(`Current count is: ${ledgerState.counter}`)
        logger.info(`Current collateral pool amount is: ${ledgerState.collateralPool}`)
        logger.info(`Current total value minted is: ${ledgerState.totalValueMinted}`)
        logger.info(`Current nonce is: ${ledgerState.nonce}`)
    }
}


const CIRCUIT_MAIN_LOOP_QUESTION = `
You can do one of the following:
  1. Mint Lucky Gold token (DEPOSIT TO MINT)
  2. Mint Lucky Freebies (FOR FREE)
  3. Display the current ledger state (known by everyone)
  4. Exit
Which would you like to do? `;


const circuit_main_loop = async (providers: TokenMintContractProviders, rli: Interface, logger: Logger): Promise<void> => {
    const mintAPI = await resolve(providers, rli, logger);
    if (mintAPI === null) return;

    let currentState: DerivedTokenMintContractState | undefined;
    const stateObserver = {
        next: (state: DerivedTokenMintContractState) => (currentState = state)
    }

    const subscription = mintAPI.state.subscribe(stateObserver);
    try {
        while (true) {
            const choice = await rli.question(CIRCUIT_MAIN_LOOP_QUESTION);
            switch (choice) {
                case "1": {
                    const amountToDeposit = await rli.question(`How much do you want to deposit (swap for lucky gold)?`)
                    await mintAPI.mintGoldToken(providers, Number(amountToDeposit), nativeToken());
                    break;
                }
                case "2": {
                    await mintAPI.mintFreeToken();
                    break;
                }
                case "3": {
                    await displayLedgerState(providers, mintAPI.allReadyDeployedContract, logger);
                    break;
                }
                case "4": {
                    logger.info("Exiting.......")
                    return;
                }
                default:
                    logger.error(`Invalid choice: ${choice}`);
            }
        }
    } finally {
        subscription.unsubscribe();
    }
};



const createWalletAndMidnightProvider = async (wallet: Wallet): Promise<WalletProvider & MidnightProvider> => {
    const state = await Rx.firstValueFrom(wallet.state());
    return {
        coinPublicKey: state.coinPublicKey,
        balanceTx(tx: UnbalancedTransaction, newCoins: CoinInfo[]): Promise<BalancedTransaction> {
            return wallet.balanceTransaction(
                ZswapTransaction.deserialize(tx.serialize(getLedgerNetworkId()), getZswapNetworkId()),
                newCoins,
            )
                .then((tx) => wallet.proveTransaction(tx))
                .then((zswapTx) => Transaction.deserialize(zswapTx.serialize(getZswapNetworkId()), getLedgerNetworkId()))
                .then(createBalancedTx);
        },
        submitTx(tx: BalancedTransaction): Promise<TransactionId> {
            return wallet.submitTransaction(tx)
        }
    }
}


const waitForFunds = (wallet: Wallet, logger: Logger) =>
    Rx.firstValueFrom(
        wallet.state().pipe(
            Rx.throttleTime(10_000),
            Rx.tap((state) => {
                const scanned = state.syncProgress?.synced ?? 0n;
                const total = state.syncProgress?.total.toString() ?? 'unknown number';
                logger.info(`Wallet processed ${scanned} indices out of ${total}`);
            }),
            Rx.filter((state) => {
                // Let's allow progress only if wallet is close enough
                const synced = state.syncProgress?.synced ?? 0n;
                const total = state.syncProgress?.total ?? 1_000n;
                return total - synced < 100n;
            }),
            Rx.map((s) => s.balances[nativeToken()] ?? 0n),
            Rx.filter((balance) => balance > 0n),
        ),
    );


const buildWalletAndWaitForFunds = async (
    { indexer, indexerWS, node, proofServer }: Config,
    logger: Logger,
    seed: string,
): Promise<Wallet & Resource> => {
    const wallet = await WalletBuilder.build(
        indexer,
        indexerWS,
        proofServer,
        node,
        seed,
        getZswapNetworkId(),
        'warn',
    );
    wallet.start();
    const state = await Rx.firstValueFrom(wallet.state());
    logger.info(`Your wallet seed is: ${seed}`);
    logger.info(`Your wallet address is: ${state.address}`);
    let balance = state.balances[nativeToken()];
    if (balance === undefined || balance === 0n) {
        logger.info(`Your wallet balance is: 0`);
        logger.info(`Waiting to receive tokens...`);
        balance = await waitForFunds(wallet, logger);
    }
    logger.info(`Your wallet balance is: ${balance}`);
    return wallet;
};

// Generate a random see and create the wallet with that.
const buildFreshWallet = async (config: Config, logger: Logger): Promise<Wallet & Resource> =>
    await buildWalletAndWaitForFunds(config, logger, toHex(utils.randomNonceBytes(32)));

// Prompt for a seed and create the wallet with that.
const buildWalletFromSeed = async (config: Config, rli: Interface, logger: Logger): Promise<Wallet & Resource> => {
    const seed = await rli.question('Enter your wallet seed: ');
    return await buildWalletAndWaitForFunds(config, logger, seed);
};

/* ***********************************************************************
 * This seed gives access to tokens minted in the genesis block of a local development node - only
 * used in standalone networks to build a wallet with initial funds.
 */
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const WALLET_LOOP_QUESTION = `
You can do one of the following:
  1. Build a fresh wallet
  2. Build wallet from a seed
  3. Exit
Which would you like to do? `;

const buildWallet = async (config: Config, rli: Interface, logger: Logger): Promise<(Wallet & Resource) | null> => {
    if (config instanceof StandaloneConfig) {
        return await buildWalletAndWaitForFunds(config, logger, GENESIS_MINT_WALLET_SEED);
    }
    while (true) {
        const choice = await rli.question(WALLET_LOOP_QUESTION);
        switch (choice) {
            case '1':
                return await buildFreshWallet(config, logger);
            case '2':
                return await buildWalletFromSeed(config, rli, logger);
            case '3':
                logger.info('Exiting...');
                return null;
            default:
                logger.error(`Invalid choice: ${choice}`);
        }
    }
};

const mapContainerPort = (env: StartedDockerComposeEnvironment, url: string, containerName: string) => {
    const mappedUrl = new URL(url);
    const container = env.getContainer(containerName);

    mappedUrl.port = String(container.getFirstMappedPort());

    return mappedUrl.toString().replace(/\/+$/, '');
};



export const run = async (config: Config, logger: Logger, dockerEnv?: DockerComposeEnvironment): Promise<void> => {
    const rli = createInterface({ input, output, terminal: true });
    let env;
    if (dockerEnv !== undefined) {
        env = await dockerEnv.up();

        if (config instanceof StandaloneConfig) {
            config.indexer = mapContainerPort(env, config.indexer, 'bboard-indexer');
            config.indexerWS = mapContainerPort(env, config.indexerWS, 'bboard-indexer');
            config.node = mapContainerPort(env, config.node, 'bboard-node');
            config.proofServer = mapContainerPort(env, config.proofServer, 'bboard-proof-server');
        }
    }
    const wallet = await buildWallet(config, rli, logger);
    try {
        if (wallet !== null) {
            const walletAndMidnightProvider = await createWalletAndMidnightProvider(wallet);
            const providers = {
                privateStateProvider: levelPrivateStateProvider<PrivateStateId>({
                    privateStateStoreName: config.privateStateStoreName as string,
                }),
                publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
                zkConfigProvider: new NodeZkConfigProvider<never>(config.zkConfigPath),
                proofProvider: httpClientProofProvider(config.proofServer),
                walletProvider: walletAndMidnightProvider,
                midnightProvider: walletAndMidnightProvider,
            };
            await circuit_main_loop(providers, rli, logger);
        }
    } catch (e) {
        if (e instanceof Error) {
            logger.error(`Found error '${e.message}'`);
            logger.info('Exiting...');
            logger.debug(`${e.stack}`);
        } else {
            throw e;
        }
    } finally {
        try {
            rli.close();
            rli.removeAllListeners();
        } catch (e) {
        } finally {
            try {
                if (wallet !== null) {
                    await wallet.close();
                }
            } catch (e) {
            } finally {
                try {
                    if (env !== undefined) {
                        await env.down();
                        logger.info('Goodbye');
                        process.exit(0);
                    }
                } catch (e) { }
            }
        }
    }
};


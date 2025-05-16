import { combineLatest, concat, from, map, Observable, tap } from "rxjs";
import { DeployedTokenMintOnchainContract, DerivedTokenMintContractState, TokenMintContract, TokenMintContractProviders, tokenPrivateStateId } from "./common-types.js";
import { ContractAddress, encodeTokenType } from "@midnight-ntwrk/compact-runtime";
import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { Contract, ledger, TokenMintPrivateState, witnesses, type CoinInfo } from "@token-mint/token-mint-contract";
import { type Logger } from "pino";
import * as utils from "./utils/index.js"

const tokenMintContractInstance: TokenMintContract = new Contract(witnesses);

export interface DeployedTokenMintAPI {
    readonly deployedContractAddress: ContractAddress;
    readonly state: Observable<DerivedTokenMintContractState>;
    mintGoldToken: (providers: TokenMintContractProviders, amount: number, tokenType: string) => void;
    mintFreeToken: () => void;
}

/**
 * NB: Declaring a class implements a given type, means it must contain all defined properties and methods, then take on other extra properties or class
 */
// Initializes a new contract

export class TokenMintAPI implements DeployedTokenMintAPI {
    deployedContractAddress: string;
    state: Observable<DerivedTokenMintContractState>;

    // Within the constructor set the two properties of the API Class Object
    // Using access modifiers on parameters create a property instances for that parameter and stores it as part of the object
    /**
     * @param allReadyDeployedContract
     * @param logger becomes accessible s if they were decleared as static properties as part of the class
     */
    private constructor(providers: TokenMintContractProviders, public readonly allReadyDeployedContract: DeployedTokenMintOnchainContract, private logger?: Logger){
        this.deployedContractAddress = allReadyDeployedContract.deployTxData.public.contractAddress;

        // Set the state property
        this.state = combineLatest(
            [
                providers.publicDataProvider.
                contractStateObservable(this.deployedContractAddress, {type: "all"}).pipe(
                    map((contractState) => ledger(contractState.data)),
                    tap((ledgerState) => 
                        logger?.trace({
                            ledgerStaeChanged: {
                                ledgerState: {
                                    ...ledgerState
                                }
                            }
                        })
                    )
                ),
                concat(from(providers.privateStateProvider.get(tokenPrivateStateId)))
            ],
            (ledgerState, privateState) => {
                return {
                    contractPool: ledgerState.collateralPool,
                    counter: ledgerState.counter,
                    totalValueMinted: ledgerState.totalValueMinted,
                    nonce: ledgerState.nonce 
                }
            }
        );
    }

    static async deployTokenMintContract(providers: TokenMintContractProviders, logger?: Logger): Promise<TokenMintAPI> {
        logger?.info("deploy contract")
        /**
         * Should deploy a new contract to the blockchain
         * Return the newly deployed contract
         * Log the resulting data about of the newly deployed contract using (logger)
         */
        const deployedContract = await deployContract<TokenMintContract>(providers, {
            contract: tokenMintContractInstance,
            initialPrivateState: await TokenMintAPI.getPrivateState(providers),
            privateStateId: tokenPrivateStateId,
            args: [utils.randomNonceBytes(32, logger)]
        })

        logger?.trace("Deployment successfull", {
            contractDeployed: {
                finalizedDeployTxData: deployedContract.deployTxData.public
            }
        })

        return new TokenMintAPI(providers, deployedContract, logger)
    }

    static async joinTokenMintContract(providers: TokenMintContractProviders, contractAddress: string, logger?: Logger): Promise<TokenMintAPI> {
        logger?.info({
            joinContract: {
                contractAddress,
            },
        });
        /**
        * Should deploy a new contract to the blockchain
        * Return the newly deployed contract
        * Log the resulting data about of the newly deployed contract using (logger)
        */
        const existingContract = await findDeployedContract<TokenMintContract>(providers, {
            contract: tokenMintContractInstance,
            contractAddress: contractAddress,
            privateStateId: tokenPrivateStateId,
            initialPrivateState: await TokenMintAPI.getPrivateState(providers)
        })

        logger?.trace("Found Contract...", {
             contractJoined: {
                finalizedDeployTxData: existingContract.deployTxData.public
             }
        })
        return new TokenMintAPI(providers, existingContract, logger)
    }


    async mintFreeToken() {
        this.logger?.info(`minting free token...`)
        const txData = await this.allReadyDeployedContract.callTx.mintFreeToken()

        this.logger?.trace("Free mint successful", {
            transactionAdded: {
                circuit: "mintFreeToken",
                txHash: txData.public.txHash,
                blockDetails: {
                    blockHash: txData.public.blockHash,
                    blockHeight: txData.public.blockHeight
                }
            }
        })
    };

    coin(amt: bigint, tokenType: string): CoinInfo{
        return {
            color: encodeTokenType(tokenType),
            nonce: utils.randomNonceBytes(32),
            value: amt
        };
    };

    async mintGoldToken(providers: TokenMintContractProviders, amount: number, tokenType: string) {
        this.logger?.info("Minting Gold Token...")
        // First set the amount in private state provider so compact can pick it up via witihness
        await TokenMintAPI.setPrivateState(providers, {mint_amount: BigInt(amount)});
        // Construct tx with dynamic coin data
        const txData = await this.allReadyDeployedContract.callTx.mintGoldToken(this.coin(BigInt(amount), tokenType));

        this.logger?.trace({
            transactionAdded: {
                circuit: "mintGoldToken",
                txHash: txData.public.txHash,
                mintValue: txData.public.tx.mint?.coin.value,
                blockDetails: {
                    blockHash: txData.public.blockHash,
                    blockHeight: txData.public.blockHeight,
                }
            }
        })
    };

    // Used to get the private state from the wallets privateState Provider
    private static async getPrivateState(providers: TokenMintContractProviders): Promise<TokenMintPrivateState> {
        const existingPrivateState = await providers.privateStateProvider.get(tokenPrivateStateId);
        return existingPrivateState ?? (await providers.privateStateProvider.set(tokenPrivateStateId, { mint_amount: 0n }) ?? { mint_amount: 0n });
    };

    // Used to set the private state in the wallets privateState Provider
    private static async setPrivateState(provider: TokenMintContractProviders, privateState: TokenMintPrivateState): Promise<TokenMintPrivateState> {
        const newPrivateState = await provider.privateStateProvider.set(tokenPrivateStateId, privateState);
        return newPrivateState ?? privateState;
    };
}

export * as utils from './utils/index.js';

export * from './common-types.js';
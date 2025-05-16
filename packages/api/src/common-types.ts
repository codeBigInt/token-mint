import { type FoundContract } from "@midnight-ntwrk/midnight-js-contracts";
import { MidnightProviders } from "@midnight-ntwrk/midnight-js-types";
import { Contract, TokenMintPrivateState, Witnesses } from "@token-mint/token-mint-contract";

export const tokenPrivateStateId = "tokenPrivateState";
export type TokenMintPrivateStateId = typeof tokenPrivateStateId;
export type TokenMintContract = Contract<TokenMintPrivateState, Witnesses<TokenMintPrivateState>>;
export type TokenCircuitKeys = Exclude<keyof TokenMintContract["impureCircuits"], number | symbol>;
export type TokenMintContractProviders = MidnightProviders<TokenCircuitKeys, TokenMintPrivateStateId, TokenMintPrivateState>
export type DeployedTokenMintOnchainContract = FoundContract<TokenMintContract>;
export type DerivedTokenMintContractState = {
    readonly contractPool: bigint;
    readonly totalValueMinted: bigint;
    readonly counter: bigint;
    readonly nonce: Uint8Array;
}
export * from "./managed/tokenMint/contract/index.cjs";
import { WitnessContext } from "@midnight-ntwrk/compact-runtime"
import { Ledger } from "./managed/tokenMint/contract/index.cjs"

export interface TokenMintPrivateState {
    mint_amount: bigint;
}

export const witnesses = {
    mintAmt: ({ privateState }: WitnessContext<Ledger, TokenMintPrivateState>): [TokenMintPrivateState, bigint] => [
        privateState,
        privateState.mint_amount
    ]
}
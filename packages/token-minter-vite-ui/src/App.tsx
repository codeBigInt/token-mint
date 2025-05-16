import { useCallback, useContext, useEffect, useState } from 'react'
import { Wallet, Coins } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAssets, useWallet } from "@meshsdk/midnight-react"
import { Button } from './components/ui/button'
import { nativeToken } from '@midnight-ntwrk/ledger'
import { TokenMintContext } from './context/TokenMintDeployedContractProvider'
import type { DeployedTokenMintAPI, DerivedTokenMintContractState } from '@token-mint/token-mint-api'
import type { TokenMintDeployment } from './context/BrowserDeployedTokenMntManager'
import type {ContractAddress} from "@midnight-ntwrk/compact-runtime"



function App() {
  const [balance, setBalance] = useState(0);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("eth");
  const { connectingWallet, connectWallet, disconnect } = useWallet();
  const { address, hasConnectedWallet } = useAssets();
  const tokenMintDeploymentProvider = useContext(TokenMintContext)
  const [mintDeployment, setMintDeployment] = useState<TokenMintDeployment | undefined>();
  const [deployedTokenMintAPI, setDeployedTokenMintAPI] = useState<DeployedTokenMintAPI>();
  const [errorMessage, setErrorMessage] = useState<string>()
  const [mintState, setMintState] = useState<DerivedTokenMintContractState>();


  const contractAddress = import.meta.env.CONTRACT_ADDRESS || "";



  useEffect(() => {
    if (!tokenMintDeploymentProvider) return;
    const subscription = tokenMintDeploymentProvider?.tokenMintDeployment$?.subscribe(setMintDeployment)

    return () => {
      subscription.unsubscribe();
    }
  }, [tokenMintDeploymentProvider])


  useEffect(() => {
    if (!mintDeployment || mintDeployment.status === "inactive" || mintDeployment.status === "in-progress" || mintDeployment.status === "failed") {
      setErrorMessage(
        mintDeployment?.status === "failed" ? (mintDeployment.error.message.length ? mintDeployment.error.message : "An Error occured") : "An UnExpected error occured"
      )
      return;
    }

    setDeployedTokenMintAPI(mintDeployment.api);

    const subscription = mintDeployment.api.state.subscribe(setMintState);

    return () => {
      subscription.unsubscribe()
    }
  }, [mintDeployment])



  // Handle deployment and joining of a contract
  const handleNewDeloyment = useCallback(() => tokenMintDeploymentProvider?.resolve(), [tokenMintDeploymentProvider])
  const handleJoinDeloyment = useCallback((contractAddress: ContractAddress) => tokenMintDeploymentProvider?.resolve(contractAddress), [tokenMintDeploymentProvider])


  const handleMint = () => {
    // In a real implementation, this would call the smart contract to mint tokens
    if (amount && !isNaN(Number(amount))) {
      setBalance((prev) => prev + Number(amount))
    }
  }


  return (
    <div className="flex w-screen min-h-screen overflow-x-hidden gap-4 items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">LuckyGold Token</CardTitle>
          <CardDescription>Mint your new cryptocurrency tokens</CardDescription>
          <p>{errorMessage}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {connectingWallet ? (
            <Button onClick={() => connectWallet("mnLace")} className="w-full" size="lg">
              <Wallet className="mr-2 h-4 w-4" />
              {connectingWallet ? "Connecting..." : "Connect Wallet"}
            </Button>
          ) : (
            <>
              <div className="rounded-lg bg-gray-100 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">Total Minted</span>
                  <div className="flex items-center">
                    <Coins className="mr-2 h-4 w-4 text-gray-700" />
                    <span className="font-bold text-black ">{balance} Tokens</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount to Mint</Label>
                  <Input
                    id="amount"
                    type="number"
                    placeholder="Enter amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>

                <div className="space-y-2 w-full">
                  <Label htmlFor="currency">Deposit Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id="currency">
                      <SelectValue placeholder="Select currency" />
                    </SelectTrigger>
                    <SelectContent className='w-full'>
                      <SelectItem value="eth">Ethereum (ETH)</SelectItem>
                      <SelectItem value={nativeToken()}>tUSDT</SelectItem>
                      <SelectItem value="usdc">USD Coin (USDC)</SelectItem>
                      <SelectItem value="dai">Dai (DAI)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
        </CardContent>
        <CardFooter>
          {!connectingWallet && (
            <Button onClick={handleMint} className="w-full" size="lg">
              Mint LuckyGold
            </Button>
          )}
        </CardFooter>
      </Card>
      {!connectingWallet &&
        <div className='flex flex-col gap-2'>
          <Button onClick={() => handleJoinDeloyment(contractAddress)} className="w-full" size="lg">
            Join Contract: {mintDeployment?.status} {deployedTokenMintAPI?.deployedContractAddress}
          </Button>
          <Button className="w-full pointer-events-none flex gap-2" size="lg">
            <Wallet />
            <span className='truncate w-[200px]'>{address}</span>
          </Button>
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Freebies Mint</CardTitle>
              <CardDescription>Mint your bonus LuckyFreebies tokens</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg bg-gray-100 p-4">
                <div className="flex items-center gap-8 justify-between">
                  <span className="text-sm font-medium text-gray-500">Total Minted</span>
                  <div className="flex items-center">
                    <Coins className="mr-2 h-4 w-4 text-gray-700" />
                    <span className="font-bold text-black ">{Number(mintState?.totalValueMinted)} Tokens</span>
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleMint} className="w-full" size="lg">
                Mint LuckyFreebies
              </Button>
            </CardFooter>
          </Card>
          {
            hasConnectedWallet ? (
              <div>
                <Button onClick={() => disconnect()} className="w-full" size="lg">
                  Disconnect Wallet
                </Button>
                <Button onClick={() => handleNewDeloyment()} className="w-full" size="lg">
                  Deploy Contract: {mintDeployment?.status} {deployedTokenMintAPI?.deployedContractAddress}
                </Button>
              </div>
            ) : <Button onClick={() => connectWallet("mnLace")} className="w-full" size="lg">
              Connect Wallet
            </Button>
          }
        </div>
      }
    </div>
  )
}

export default App

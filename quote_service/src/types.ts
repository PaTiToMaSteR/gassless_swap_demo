export type HexString = `0x${string}`;

export type QuoteRequest = {
  chainId?: number;
  tokenIn: HexString;
  tokenOut: HexString;
  amountIn: string; // base units
  slippageBps?: number;
  sender: HexString; // smart account address (counterfactual ok)
};

export type QuoteResponse = {
  quoteId: string;
  chainId: number;
  createdAt: number;
  expiresAt: number;
  deadline: number;
  tokenIn: HexString;
  tokenOut: HexString;
  sender: HexString;
  amountIn: string;
  amountOut: string;
  minOut: string;
  route: {
    router: HexString;
    calldata: HexString;
  };
};

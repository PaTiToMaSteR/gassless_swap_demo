import fs from "node:fs";

export type PaymasterDeployments = {
  chainId: number;
  entryPoint: string;
  simpleAccountFactory: string;
  paymaster: string;
  router: string;
  pool?: string;
  tokenIn: string;
  tokenOut: string;
};

export function readDeployments(deploymentsPath: string): PaymasterDeployments {
  const raw = fs.readFileSync(deploymentsPath, "utf8");
  return JSON.parse(raw) as PaymasterDeployments;
}


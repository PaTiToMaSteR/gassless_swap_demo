import { ethers } from "ethers";

import type { PackedUserOperationV07 } from "./types";
import { RpcError, RpcErrorCodes } from "./rpcErrors";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const entryPointSimulationsArtifact = require("@account-abstraction/contracts/artifacts/EntryPointSimulations.json");

const epSimInterface = new ethers.utils.Interface(entryPointSimulationsArtifact.abi);

export type SimulateValidationResult = {
  returnInfo: {
    preOpGas: string;
    prefund: string;
    accountValidationData: string;
    paymasterValidationData: string;
    paymasterContext: string;
  };
  senderInfo: any;
  factoryInfo: any;
  paymasterInfo: any;
  aggregatorInfo: any;
};

export async function simulateValidationV07(
  provider: ethers.providers.JsonRpcProvider,
  entryPointAddress: string,
  packedUserOp: PackedUserOperationV07,
): Promise<SimulateValidationResult> {
  const data = epSimInterface.encodeFunctionData("simulateValidation", [packedUserOp]);

  const stateOverrides = {
    [entryPointAddress]: {
      code: entryPointSimulationsArtifact.deployedBytecode,
    },
  };

  try {
    const raw = await provider.send("eth_call", [{ to: entryPointAddress, data }, "latest", stateOverrides]);
    const [res] = epSimInterface.decodeFunctionResult("simulateValidation", raw);
    return res as SimulateValidationResult;
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "simulateValidation failed";
    throw new RpcError(message, RpcErrorCodes.InternalError, err);
  }
}


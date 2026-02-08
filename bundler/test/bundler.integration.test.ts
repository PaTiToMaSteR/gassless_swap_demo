import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { ethers } from "ethers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BundlerConfig, RpcUserOperationV07 } from "../src/types";
import { startBundler } from "../src";
import { packUserOpV07 } from "../src/packing";

function foundryBin(name: "anvil" | "forge"): string {
  return path.join(os.homedir(), ".foundry", "bin", name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForRpc(rpcUrl: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      // ignore
    }
    if (Date.now() - start > timeoutMs) throw new Error(`RPC not ready: ${rpcUrl}`);
    await sleep(200);
  }
}

describe("bundler v0.7 integration (anvil)", () => {
  const anvilPort = 9545;
  const rpcUrl = `http://127.0.0.1:${anvilPort}`;
  const mnemonic = "test test test test test test test test test test test junk";

  let anvil: ReturnType<typeof spawn> | undefined;
  let bundlerServer: Awaited<ReturnType<typeof startBundler>> | undefined;
  let monitorServer: http.Server | undefined;
  let monitorUrl: string | undefined;
  const ingestedLogs: any[] = [];

  const deployerPk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  const repoRoot = path.resolve(__dirname, "..", "..");
  const paymasterDir = path.join(repoRoot, "paymaster");

  beforeAll(async () => {
    monitorServer = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url?.split("?")[0] !== "/api/logs/ingest") {
        res.statusCode = 404;
        return res.end("not found");
      }
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.from(c)));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (Array.isArray(body)) ingestedLogs.push(...body);
          else ingestedLogs.push(body);
        } catch {
          // ignore
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => monitorServer!.listen(0, "127.0.0.1", () => resolve()));
    const addr = monitorServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    monitorUrl = `http://127.0.0.1:${port}`;

    anvil = spawn(foundryBin("anvil"), [
      "--silent",
      "--port",
      String(anvilPort),
      "--chain-id",
      "31337",
      "--mnemonic",
      mnemonic,
    ]);

    await waitForRpc(rpcUrl);

    // deploy contracts to this anvil instance
    const env = {
      ...process.env,
      PATH: `${path.join(os.homedir(), ".foundry", "bin")}:${process.env.PATH ?? ""}`,
      DEPLOYER_PRIVATE_KEY: deployerPk,
    };

    const deploy = spawn(foundryBin("forge"), [
      "script",
      "script/Deploy.s.sol:Deploy",
      "--rpc-url",
      rpcUrl,
      "--broadcast",
      "-q",
    ], { cwd: paymasterDir, env });

    await new Promise<void>((resolve, reject) => {
      deploy.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`forge script failed: exit ${code}`));
      });
    });

    const exportAbis = spawn(path.join(paymasterDir, "scripts", "export-abis.sh"), ["local"], {
      cwd: paymasterDir,
      env,
    });
    await new Promise<void>((resolve, reject) => {
      exportAbis.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`export-abis.sh failed: ${code}`))));
    });

    process.env.BUNDLER_PRIVATE_KEY = deployerPk;

    const addressesPath = path.join(paymasterDir, "deployments", "local", "addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8")) as {
      entryPoint: string;
      simpleAccountFactory: string;
      paymaster: string;
      router: string;
      tokenIn: string;
      tokenOut: string;
    };

    const bundlerPort = 3333;
    const bundlerConfig: BundlerConfig = {
      network: rpcUrl,
      entryPoint: addresses.entryPoint,
      port: String(bundlerPort),
      beneficiary: ethers.constants.AddressZero,
      minBalance: "0",
      autoBundleInterval: 1,
      autoBundleMempoolSize: 1,
      maxBundleGas: 12_000_000,
      unsafe: true,
      policy: { strict: true, minValidUntilSeconds: 0 },
      observability: { monitorUrl, service: "bundler_test" },
    };

    bundlerServer = await startBundler(bundlerConfig);
  }, 120_000);

  afterAll(async () => {
    await bundlerServer?.stop();
    anvil?.kill("SIGTERM");
    if (monitorServer) await new Promise<void>((resolve) => monitorServer.close(() => resolve()));
  });

  it("accepts eth_sendUserOperation and returns a receipt", async () => {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    const addressesPath = path.join(paymasterDir, "deployments", "local", "addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8")) as {
      entryPoint: string;
      simpleAccountFactory: string;
      paymaster: string;
      router: string;
      tokenIn: string;
      tokenOut: string;
    };

    const abiDir = path.join(paymasterDir, "deployments", "local", "abis");
    const factoryAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "SimpleAccountFactory.abi.json"), "utf8"));
    const simpleAccountAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "SimpleAccount.abi.json"), "utf8"));
    const entryPointAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "EntryPoint.abi.json"), "utf8"));
    const tokenAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "TestERC20.abi.json"), "utf8"));
    const routerAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "DemoRouter.abi.json"), "utf8"));

    const deployer = new ethers.Wallet(deployerPk, provider);
    const a = String.fromCharCode(39);
    const ownerPath = `m/44${a}/60${a}/0${a}/0/1`;
    const owner = ethers.Wallet.fromMnemonic(mnemonic, ownerPath).connect(provider);

    const factory = new ethers.Contract(addresses.simpleAccountFactory, factoryAbi, provider);
    const entryPoint = new ethers.Contract(addresses.entryPoint, entryPointAbi, provider);
    const tokenIn = new ethers.Contract(addresses.usdc, tokenAbi, deployer);
    const router = new ethers.Contract(addresses.router, routerAbi, provider);

    const salt = 0;
    const sender: string = await factory.getAddress(owner.address, salt);

    const amountIn = ethers.BigNumber.from("1000000000"); // 1000e6
    const expectedOut = await router.quoteExactIn(addresses.usdc, addresses.tokenOut, amountIn);
    const minOut = expectedOut.mul(9900).div(10000); // 99% slippage
    const feeAmount = ethers.utils.parseEther("0.01");
    expect(minOut.gte(feeAmount)).toBe(true);

    // fund counterfactual smart account with tokenIn
    await (await tokenIn.mint(sender, amountIn)).wait();

    const targets = [addresses.usdc, addresses.router, addresses.tokenOut];
    const values = [0, 0, 0];
    const datas = [
      new ethers.utils.Interface(tokenAbi).encodeFunctionData("approve", [addresses.router, amountIn]),
      new ethers.utils.Interface(routerAbi).encodeFunctionData("swapExactIn", [
        addresses.usdc,
        addresses.tokenOut,
        amountIn,
        minOut,
        sender,
        Math.floor(Date.now() / 1000) + 60,
      ]),
      new ethers.utils.Interface(tokenAbi).encodeFunctionData("transfer", [addresses.paymaster, feeAmount]),
    ];

    const callData = new ethers.utils.Interface(simpleAccountAbi).encodeFunctionData("executeBatch", [
      targets,
      values,
      datas,
    ]);

    const factoryData = new ethers.utils.Interface(factoryAbi).encodeFunctionData("createAccount", [owner.address, salt]);

    const userOp: RpcUserOperationV07 = {
      sender: sender as any,
      nonce: "0x0" as any,
      factory: addresses.simpleAccountFactory as any,
      factoryData: factoryData as any,
      callData: callData as any,
      callGasLimit: "0x1e8480" as any, // 2,000,000
      verificationGasLimit: "0x1e8480" as any,
      preVerificationGas: "0x186a0" as any, // 100,000
      maxFeePerGas: "0x3b9aca00" as any, // 1 gwei
      maxPriorityFeePerGas: "0x3b9aca00" as any,
      paymaster: addresses.paymaster as any,
      paymasterVerificationGasLimit: "0x30d40" as any, // 200,000
      paymasterPostOpGasLimit: "0x30d40" as any,
      paymasterData: "0x" as any,
      signature: "0x" as any,
      eip7702Auth: null,
    };

    const packed = packUserOpV07(userOp);
    const userOpHash: string = await entryPoint.callStatic.getUserOpHash(packed);
    const signature = await owner.signMessage(ethers.utils.arrayify(userOpHash));
    userOp.signature = signature as any;

    const bundlerUrl = "http://127.0.0.1:3333/rpc";
    const sendRes = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendUserOperation",
        params: [userOp, addresses.entryPoint],
      }),
    }).then((r) => r.json());

    expect(sendRes.result).toBe(userOpHash);

    // poll for receipt
    const start = Date.now();
    let bundleTxHash = "";
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const recRes = await fetch(bundlerUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "eth_getUserOperationReceipt",
          params: [userOpHash],
        }),
      }).then((r) => r.json());

      if (recRes.result) {
        expect(recRes.result.success).toBe(true);
        expect(recRes.result.sender.toLowerCase()).toBe(sender.toLowerCase());
        bundleTxHash = String(recRes.result.receipt?.transactionHash ?? "");
        break;
      }
      if (Date.now() - start > 60_000) throw new Error("timed out waiting for receipt");
      await sleep(500);
    }

    // bundler ships structured logs to the monitor ingest endpoint
    const waitFor = async (pred: () => boolean, timeoutMs = 5_000) => {
      const t0 = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (pred()) return;
        if (Date.now() - t0 > timeoutMs) throw new Error("timed out waiting for ingested logs");
        await sleep(100);
      }
    };

    await waitFor(() =>
      ingestedLogs.some(
        (e) =>
          e?.service === "bundler_test" &&
          e?.msg === "userOp accepted" &&
          String(e?.userOpHash ?? "").toLowerCase() === userOpHash.toLowerCase() &&
          String(e?.sender ?? "").toLowerCase() === sender.toLowerCase(),
      ),
    );

    await waitFor(() =>
      ingestedLogs.some(
        (e) =>
          e?.service === "bundler_test" &&
          e?.msg === "userOp mined" &&
          String(e?.userOpHash ?? "").toLowerCase() === userOpHash.toLowerCase() &&
          String(e?.txHash ?? "").toLowerCase() === bundleTxHash.toLowerCase(),
      ),
    );
  }, 120_000);

  it("estimates gas for a deployed sender without factory fields (regression)", async () => {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    const addressesPath = path.join(paymasterDir, "deployments", "local", "addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8")) as {
      entryPoint: string;
      simpleAccountFactory: string;
      paymaster: string;
      router: string;
      oracle: string;
      tokenIn: string;
      tokenOut: string;
    };

    const abiDir = path.join(paymasterDir, "deployments", "local", "abis");
    const factoryAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "SimpleAccountFactory.abi.json"), "utf8"));
    const simpleAccountAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "SimpleAccount.abi.json"), "utf8"));
    const entryPointAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "EntryPoint.abi.json"), "utf8"));
    const tokenAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "TestERC20.abi.json"), "utf8"));
    const routerAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "DemoRouter.abi.json"), "utf8"));

    const deployer = new ethers.Wallet(deployerPk, provider);
    const a = String.fromCharCode(39);
    const ownerPath = `m/44${a}/60${a}/0${a}/0/2`;
    const owner = ethers.Wallet.fromMnemonic(mnemonic, ownerPath).connect(provider);

    const factory = new ethers.Contract(addresses.simpleAccountFactory, factoryAbi, deployer);
    const entryPoint = new ethers.Contract(addresses.entryPoint, entryPointAbi, provider);
    const oracle = new ethers.Contract(addresses.oracle, ["function getPrice(address) view returns (uint256)", "function decimals(address) view returns (uint8)"], provider);

    const salt = 0;
    const sender: string = await factory.getAddress(owner.address, salt);

    // Ensure the account is deployed so we can omit `factory`/`factoryData` (initCode must be empty).
    if ((await provider.getCode(sender)) === "0x") {
      await (await factory.createAccount(owner.address, salt)).wait();
    }
    expect(await provider.getCode(sender)).not.toBe("0x");

    const nonce = await entryPoint.getNonce(sender, 0);

    const amountIn = ethers.BigNumber.from("1000000000"); // 1000e6

    // Calculate fairOut based on Oracle price to satisfy Paymaster's SlippageRisk check
    const oraclePrice = await oracle.getPrice(addresses.usdc);
    const tokenDecimals = await oracle.decimals(addresses.usdc); // Should be 6
    const fairOut = amountIn.mul(oraclePrice).div(ethers.BigNumber.from(10).pow(tokenDecimals));
    // Set minOut to 96% of fairOut (Paymaster requires >95%)
    const minOut = fairOut.mul(96).div(100);

    const feeAmount = ethers.constants.Zero;

    const targets = [addresses.usdc, addresses.router, addresses.tokenOut];
    const values = [0, 0, 0];
    const datas = [
      new ethers.utils.Interface(tokenAbi).encodeFunctionData("approve", [addresses.router, amountIn]),
      new ethers.utils.Interface(routerAbi).encodeFunctionData("swapExactIn", [
        addresses.usdc,
        addresses.tokenOut,
        amountIn,
        minOut,
        sender,
        Math.floor(Date.now() / 1000) + 60,
      ]),
      new ethers.utils.Interface(tokenAbi).encodeFunctionData("transfer", [addresses.paymaster, feeAmount]),
    ];

    const callData = new ethers.utils.Interface(simpleAccountAbi).encodeFunctionData("executeBatch", [
      targets,
      values,
      datas,
    ]);

    const dummySig = ethers.utils.hexConcat([
      ethers.utils.hexZeroPad("0x01", 32),
      ethers.utils.hexZeroPad("0x01", 32),
      "0x1b",
    ]);

    const userOp: RpcUserOperationV07 = {
      sender: sender as any,
      nonce: ethers.BigNumber.from(nonce).toHexString() as any,
      callData: callData as any,
      callGasLimit: "0x186a00" as any, // 1,600,000
      verificationGasLimit: "0x927c0" as any, // 600,000
      preVerificationGas: "0x186a0" as any, // 100,000
      maxFeePerGas: "0x0" as any, // requiredPrefund=0 so paymaster fee checks don't block this regression
      maxPriorityFeePerGas: "0x0" as any,
      paymaster: addresses.paymaster as any,
      paymasterVerificationGasLimit: "0x30d40" as any, // 200,000
      paymasterPostOpGasLimit: "0x30d40" as any,
      paymasterData: "0x" as any,
      signature: dummySig as any,
      eip7702Auth: null,
    };

    const bundlerUrl = "http://127.0.0.1:3333/rpc";
    const estimateRes = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_estimateUserOperationGas",
        params: [userOp, addresses.entryPoint],
      }),
    }).then((r) => r.json());

    if (estimateRes?.error) {
      console.error("Estimate Error Detail:", JSON.stringify(estimateRes.error, null, 2));
      fs.writeFileSync("bundler_error.json", JSON.stringify(estimateRes.error, null, 2));
      throw new Error(`eth_estimateUserOperationGas failed: ${JSON.stringify(estimateRes.error)}`);
    }

    expect(typeof estimateRes?.result?.callGasLimit).toBe("string");
    expect(typeof estimateRes?.result?.verificationGasLimit).toBe("string");
    expect(typeof estimateRes?.result?.preVerificationGas).toBe("string");
    expect(String(estimateRes.result.callGasLimit)).toMatch(/^0x/i);
  }, 60_000);
});

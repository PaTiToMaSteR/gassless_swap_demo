import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ethers } from "ethers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QuoteServiceServer } from "../src/server";

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

describe("quote_service integration (anvil)", () => {
  const anvilPort = 9645;
  const rpcUrl = `http://127.0.0.1:${anvilPort}`;
  const mnemonic = "test test test test test test test test test test test junk";

  let anvil: ReturnType<typeof spawn> | undefined;
  let server: QuoteServiceServer | undefined;
  let baseUrl = "";

  const deployerPk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  const repoRoot = path.resolve(__dirname, "..", "..");
  const paymasterDir = path.join(repoRoot, "paymaster");

  beforeAll(async () => {
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
      deploy.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`forge script failed: ${code}`))));
    });

    const exportAbis = spawn(path.join(paymasterDir, "scripts", "export-abis.sh"), ["local"], {
      cwd: paymasterDir,
      env,
    });
    await new Promise<void>((resolve, reject) => {
      exportAbis.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`export-abis.sh failed: ${code}`))));
    });

    const deploymentsPath = path.join(paymasterDir, "deployments", "local", "addresses.json");
    server = new QuoteServiceServer({
      host: "127.0.0.1",
      port: 0,
      rpcUrl,
      deploymentsPath,
      quoteTtlSec: 1,
      logIngestUrl: undefined,
      dataDir: "/tmp/gasless-swap-quote-service-test",
    });

    const started = await server.start();
    baseUrl = started.url;
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
    anvil?.kill("SIGTERM");
  });

  it("returns amountOut/minOut and router calldata with TTL", async () => {
    const paymasterDir = path.join(repoRoot, "paymaster");
    const deploymentsPath = path.join(paymasterDir, "deployments", "local", "addresses.json");
    const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8")) as any;

    const abiDir = path.join(paymasterDir, "deployments", "local", "abis");
    const factoryAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "SimpleAccountFactory.abi.json"), "utf8"));
    const routerAbi = JSON.parse(fs.readFileSync(path.join(abiDir, "DemoRouter.abi.json"), "utf8"));

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const a = String.fromCharCode(39);
    const ownerPath = `m/44${a}/60${a}/0${a}/0/1`;
    const owner = ethers.Wallet.fromMnemonic(mnemonic, ownerPath).connect(provider);

    const factory = new ethers.Contract(deployments.simpleAccountFactory, factoryAbi, provider);
    const sender = await factory.getAddress(owner.address, 0);

    const amountIn = "1000000000"; // 1000e6
    const postRes = await fetch(`${baseUrl}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chainId: 31337,
        tokenIn: deployments.usdc,
        tokenOut: deployments.tokenOut,
        amountIn,
        slippageBps: 50,
        sender,
      }),
    }).then((r) => r.json());

    expect(postRes.quoteId).toMatch(/^quote_/);
    expect(Number(postRes.amountOut)).toBeGreaterThan(0);
    expect(Number(postRes.minOut)).toBeGreaterThan(0);
    expect(Number(postRes.minOut)).toBeLessThanOrEqual(Number(postRes.amountOut));

    const now = Math.floor(Date.now() / 1000);
    expect(postRes.deadline).toBeGreaterThanOrEqual(now);

    const iface = new ethers.utils.Interface(routerAbi);
    const decoded = iface.decodeFunctionData("swapExactIn", postRes.route.calldata);
    expect(decoded[0].toLowerCase()).toBe(deployments.usdc.toLowerCase());
    expect(decoded[1].toLowerCase()).toBe(deployments.tokenOut.toLowerCase());
    expect(decoded[2].toString()).toBe(amountIn);
    expect(decoded[4].toLowerCase()).toBe(sender.toLowerCase());
    expect(decoded[5].toNumber()).toBe(postRes.deadline);

    // TTL behavior
    const ok = await fetch(`${baseUrl}/quote/${postRes.quoteId}`).then((r) => r.status);
    expect(ok).toBe(200);

    // Expiry is checked with second granularity, so poll until we cross the boundary.
    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const expired = await fetch(`${baseUrl}/quote/${postRes.quoteId}`).then((r) => r.status);
      if (expired === 410) break;
      if (Date.now() - start > 5_000) throw new Error(`timed out waiting for quote expiry (last=${expired})`);
      await sleep(250);
    }
  }, 60_000);
});

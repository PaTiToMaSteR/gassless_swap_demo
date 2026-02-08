import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import axios from "axios";

// Minimal ABI for the bot
const FACTORY_ABI = ["function getAddress(address,uint256) view returns (address)", "function createAccount(address,uint256) external returns (address)"];
const ENTRY_POINT_ABI = [
    "function getNonce(address,uint192) view returns (uint256)",
    "function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)) view returns (bytes32)"
];
const TOKEN_ABI = ["function approve(address,uint256) external", "function transfer(address,uint256) external", "function mint(address,uint256) external", "function balanceOf(address) view returns (uint256)"];
const ACCOUNT_ABI = ["function executeBatch(address[],uint256[],bytes[]) external"];

const ROOT_DIR = path.join(__dirname, "..");
const PAYMASTER_DIR = path.join(ROOT_DIR, "paymaster");
const ADDRESSES_PATH = path.join(PAYMASTER_DIR, "deployments", "local", "addresses.json");
const RPC_URL_DEFAULT = "http://127.0.0.1:9545"; // Bundler RPC (fallback)
const QUOTE_URL = "http://127.0.0.1:3001";
const MONITOR_URL = "http://127.0.0.1:3002";
const MNEMONIC = "test test test test test test test test test test test junk";

async function main() {
    const duration = parseInt(process.env.STRESS_DURATION || "60");
    const interval = parseInt(process.env.STRESS_INTERVAL || "1000"); // ms between bursts

    console.log(`[bot] Starting stress test for ${duration}s...`);

    const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
    const localProvider = new ethers.providers.JsonRpcProvider("http://127.0.0.1:8545");

    // 0. Discover Bundler
    console.log("[bot] Discovering healthy bundler from monitor...");
    let bundlerRpc = "";
    for (let i = 0; i < 30; i++) {
        try {
            const bRes = await axios.get(`${MONITOR_URL}/api/public/bundlers`);
            const up = bRes.data.find((b: any) => b.status === "UP");
            if (up) {
                bundlerRpc = up.rpcUrl;
                break;
            }
        } catch (e) { }
        await new Promise(r => setTimeout(r, 2000));
    }

    if (!bundlerRpc) {
        throw new Error("No healthy bundler found after timeout");
    }
    console.log(`[bot] Using Bundler RPC: ${bundlerRpc}`);

    const provider = new ethers.providers.JsonRpcProvider(bundlerRpc);

    // Use a different index than common tests to avoid nonce collisions if possible
    const a = String.fromCharCode(39);
    const ownerPath = `m/44${a}/60${a}/0${a}/0/5`;
    const owner = ethers.Wallet.fromMnemonic(MNEMONIC, ownerPath).connect(localProvider);

    const entryPoint = new ethers.Contract(addresses.entryPoint, ENTRY_POINT_ABI, localProvider);
    const factory = new ethers.Contract(addresses.simpleAccountFactory, FACTORY_ABI, localProvider);
    const tokenIn = new ethers.Contract(addresses.usdc, TOKEN_ABI, localProvider);

    const sender = await factory.getAddress(owner.address, 0);
    console.log(`[bot] Sender: ${sender}`);

    // Ensure account is funded and deployed
    if ((await localProvider.getCode(sender)) === "0x") {
        console.log("[bot] Deploying sender...");
        const deployer = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", localProvider);
        // Mint some USDC for the sender first
        const tokenAsDeployer = tokenIn.connect(deployer);
        await (await tokenAsDeployer.mint(sender, ethers.utils.parseUnits("1000000", 6))).wait();

        const factoryAsOwner = factory.connect(owner);
        await (await factoryAsOwner.createAccount(owner.address, 0)).wait();
    }

    let success = 0;
    let failure = 0;
    const startTime = Date.now();
    const endTime = startTime + duration * 1000;

    const accountInterface = new ethers.utils.Interface(ACCOUNT_ABI);
    const tokenInterface = new ethers.utils.Interface(TOKEN_ABI);

    while (Date.now() < endTime) {
        try {
            // 1. Get Quote
            const quoteRes = await axios.post(`${QUOTE_URL}/quote`, {
                tokenIn: addresses.usdc,
                tokenOut: addresses.tokenOut,
                amountIn: "1000000", // 1 USDC
                sender
            });
            const { route, minOut } = quoteRes.data;
            const swapData = route.calldata;
            const feeAmount = ethers.utils.parseEther("0.001"); // Fixed mock fee

            // 2. Build UserOp
            const nonce = await entryPoint.getNonce(sender, 0);

            const targets = [addresses.usdc, addresses.router];
            const values = [0, 0];
            const datas = [
                tokenInterface.encodeFunctionData("approve", [addresses.router, "1000000"]),
                swapData
            ];

            // Add fee transfer if needed (simplified)
            targets.push(addresses.tokenOut);
            values.push(0);
            datas.push(tokenInterface.encodeFunctionData("transfer", [addresses.paymaster, feeAmount]));

            const callData = accountInterface.encodeFunctionData("executeBatch", [targets, values, datas]);

            const toHex = (val: any) => "0x" + BigInt(val).toString(16);

            const userOp: any = {
                sender,
                nonce: toHex(nonce),
                initCode: "0x",
                callData,
                accountGasLimits: ethers.utils.hexConcat([ethers.utils.hexZeroPad("0x1e8480", 16), ethers.utils.hexZeroPad("0x1e8480", 16)]),
                preVerificationGas: toHex(100000),
                gasFees: ethers.utils.hexConcat([ethers.utils.hexZeroPad("0x3b9aca00", 16), ethers.utils.hexZeroPad("0x3b9aca00", 16)]),
                paymasterAndData: ethers.utils.hexConcat([
                    addresses.paymaster,
                    ethers.utils.hexZeroPad("0x30d40", 16),
                    ethers.utils.hexZeroPad("0x30d40", 16),
                    "0x"
                ]),
                signature: "0x",
            };

            // Sign
            const userOpHash = await entryPoint.getUserOpHash(userOp);
            userOp.signature = await owner.signMessage(ethers.utils.arrayify(userOpHash));

            // Submit
            await axios.post(bundlerRpc, {
                jsonrpc: "2.0",
                id: 1,
                method: "eth_sendUserOperation",
                params: [userOp, addresses.entryPoint]
            });

            success++;
            if (success % 5 === 0) console.log(`[bot] Sent ${success} UserOps...`);
        } catch (err: any) {
            failure++;
            console.error(`[bot] Error sending UserOp: ${err.message}`);
            if (err.response?.data) {
                console.error(`[bot] Error Details: ${JSON.stringify(err.response.data)}`);
            }
        }

        await new Promise(r => setTimeout(r, interval));
    }

    console.log(`[bot] Finished. Success: ${success}, Failure: ${failure}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

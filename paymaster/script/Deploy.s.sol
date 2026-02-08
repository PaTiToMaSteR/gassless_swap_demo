// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";

import "account-abstraction/core/EntryPoint.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/samples/SimpleAccountFactory.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../src/demo/TestERC20.sol";
import "../src/demo/WNative.sol";
import "../src/demo/DemoPool.sol";
import "../src/demo/DemoRouter.sol";
import "../src/GaslessSwapPaymaster.sol";

/**
 * @title Deploy Script
 * @dev Foundry script to deploy the full suite of contracts for the GaslessSwapPaymaster demo.
 *
 * The script performs the following steps:
 * 1. Loads the deployer's private key from environment variables.
 * 2. Deploys (or interacts with an existing) EntryPoint.
 * 3. Deploys a SimpleAccountFactory for user accounts.
 * 4. Deploys mock ERC20 tokens (USDC-like and Wrapped Native).
 * 5. Deploys the DemoPool and DemoRouter to provide a dummy swap environment.
 * 6. Deploys the GaslessSwapPaymaster contract.
 * 7. Configures the Paymaster's initial sponsorship policies.
 * 8. Seeds initial liquidity into the swap pool.
 * 9. Funds the Paymaster's deposit in the EntryPoint so it can begin sponsoring transactions.
 * 10. Records all deployed addresses into a JSON file for frontend/tooling use.
 */
contract Deploy is Script {
    /**
     * @dev Container for all deployed contract addresses.
     */
    struct Deployments {
        address entryPoint;
        address factory;
        address paymaster;
        address router;
        address pool;
        address tokenIn;
        address tokenOut;
    }

    /**
     * @notice Main entry point for the deployment script.
     * @return d The struct containing all addresses of the newly deployed contracts.
     */
    function run() external returns (Deployments memory d) {
        // Retrieve deployment configuration from environment variables
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Allow overriding the EntryPoint if deploying to a network where it exists (like Fuji)
        address entryPointOverride = vm.envOr("ENTRYPOINT_ADDRESS", address(0));

        // Begin recording transactions to be broadcasted to the network
        vm.startBroadcast(deployerKey);

        // --- Step 1: EntryPoint & Factory ---
        IEntryPoint ep;
        if (entryPointOverride != address(0)) {
            ep = IEntryPoint(entryPointOverride);
        } else {
            // Deploy a fresh EntryPoint for local testing
            ep = IEntryPoint(address(new EntryPoint()));
        }

        SimpleAccountFactory factory = new SimpleAccountFactory(ep);

        // --- Step 2: Tokens ---
        // tokenIn: Simulated USDC (6 decimals)
        // tokenOut: Simulated native wrapper (e.g. WAVAX)
        TestERC20 tokenIn = new TestERC20("Test USDC", "tUSDC", 6);
        WNative tokenOut = new WNative("Wrapped AVAX", "WAVAX");

        // --- Step 3: Swap Infrastructure ---
        // Sets up a basic 1:1 pool with 0.3% fee (30 bps) for the tokens
        DemoPool pool = new DemoPool(address(tokenIn), address(tokenOut), 30);
        DemoRouter router = new DemoRouter(pool);

        // --- Step 4: Paymaster ---
        GaslessSwapPaymaster paymaster = new GaslessSwapPaymaster(
            ep,
            router,
            address(tokenIn),
            address(tokenOut)
        );

        // Configure sponsorship rules (can be overridden via environment variables)
        paymaster.setPolicy({
            gasBufferBps_: vm.envOr("PAYMASTER_GAS_BUFFER_BPS", uint256(500)),
            fixedMarkupWei_: vm.envOr("PAYMASTER_FIXED_MARKUP_WEI", uint256(0)),
            minDepositWei_: vm.envOr("PAYMASTER_MIN_DEPOSIT_WEI", uint256(0)),
            minDelayBetweenOpsSec_: uint48(
                vm.envOr("PAYMASTER_MIN_DELAY_SEC", uint256(0))
            )
        });

        // --- Step 5: Liquidity Seeding ---
        // Ensuring the router has enough depth to handle swaps for gas fees
        uint256 seedUsdc = vm.envOr("SEED_USDC", uint256(1_000_000e6));
        uint256 seedWavax = vm.envOr("SEED_WAVAX", uint256(1_000 ether));

        tokenIn.mint(deployer, seedUsdc * 2);
        tokenOut.deposit{value: seedWavax * 2}();

        // Approve and add liquidity to the pool
        IERC20(address(tokenIn)).approve(address(pool), type(uint256).max);
        IERC20(address(tokenOut)).approve(address(pool), type(uint256).max);
        pool.addLiquidity(seedUsdc, seedWavax);

        // --- Step 6: Paymaster Funding ---
        // The Paymaster needs native tokens deposited in EntryPoint to cover sponsored gas
        uint256 paymasterDeposit = vm.envOr(
            "PAYMASTER_DEPOSIT_WEI",
            uint256(10 ether)
        );
        paymaster.deposit{value: paymasterDeposit}();

        // Capture all results
        d = Deployments({
            entryPoint: address(ep),
            factory: address(factory),
            paymaster: address(paymaster),
            router: address(router),
            pool: address(pool),
            tokenIn: address(tokenIn),
            tokenOut: address(tokenOut)
        });

        // End broadcast session
        vm.stopBroadcast();

        // Persistence: save the addresses for the client application
        _writeDeployments(d);
    }

    /**
     * @notice Helper to persist deployment results to a JSON file.
     * @param d Struct containing the addresses to save.
     */
    function _writeDeployments(Deployments memory d) internal {
        string memory root = vm.projectRoot();
        // Detect network based on chainId (Fuji Testnet vs others)
        string memory network = block.chainid == 43113 ? "fuji" : "local";

        string memory dir = string.concat(root, "/deployments/", network);
        vm.createDir(dir, true);

        string memory path = string.concat(dir, "/addresses.json");

        // Format the JSON content manually (common pattern in Foundry scripts)
        string memory json = string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(block.chainid),
            ",\n",
            '  "entryPoint": "',
            vm.toString(d.entryPoint),
            '",\n',
            '  "simpleAccountFactory": "',
            vm.toString(d.factory),
            '",\n',
            '  "paymaster": "',
            vm.toString(d.paymaster),
            '",\n',
            '  "router": "',
            vm.toString(d.router),
            '",\n',
            '  "pool": "',
            vm.toString(d.pool),
            '",\n',
            '  "tokenIn": "',
            vm.toString(d.tokenIn),
            '",\n',
            '  "tokenOut": "',
            vm.toString(d.tokenOut),
            '"\n',
            "}\n"
        );

        vm.writeFile(path, json);
        console2.log("Wrote deployments:", path);
    }
}

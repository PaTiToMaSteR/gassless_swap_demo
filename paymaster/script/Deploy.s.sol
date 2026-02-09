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
import "../src/demo/MockPriceOracle.sol";
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
        address oracle;
        address tokenOut; // WAVAX
        address usdc;
        address bnb;
        address usdcPool;
        address bnbPool;
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

        // --- Step 2: Tokens & Oracle ---
        TestERC20 usdc = new TestERC20("Test USDC", "tUSDC", 6);
        TestERC20 bnb = new TestERC20("Fake BNB", "fBNB", 18);
        WNative tokenOut = new WNative("Wrapped AVAX", "WAVAX");
        MockPriceOracle oracle = new MockPriceOracle();

        // Seed Oracle prices (relative to 1 ETH/AVAX)
        // 1 ETH = 1000 USDC (6 decimals) -> 1 USDC = 0.001 ETH = 1,000,000,000,000,000 Wei (1e15)
        // 1 ETH = 5 BNB (18 decimals) -> 1 BNB = 0.2 ETH = 200,000,000,000,000,000 Wei (2e17)
        oracle.setPrice(address(usdc), 1e15, 6);
        oracle.setPrice(address(bnb), 0.2 ether, 18);

        // --- Step 3: Swap Infrastructure ---
        DemoPool usdcPool = new DemoPool(address(usdc), address(tokenOut), 30);
        DemoPool bnbPool = new DemoPool(address(bnb), address(tokenOut), 30);
        DemoRouter router = new DemoRouter(usdcPool); // default router uses USDC

        // --- Step 4: Paymaster ---
        GaslessSwapPaymaster paymaster = new GaslessSwapPaymaster(
            ep,
            router,
            oracle,
            address(usdc),
            address(tokenOut)
        );

        // Configure sponsorship rules
        paymaster.setPolicy({
            gasBufferBps_: vm.envOr("PAYMASTER_GAS_BUFFER_BPS", uint256(500)),
            fixedMarkupWei_: vm.envOr("PAYMASTER_FIXED_MARKUP_WEI", uint256(0)),
            minDepositWei_: vm.envOr("PAYMASTER_MIN_DEPOSIT_WEI", uint256(0)),
            minDelayBetweenOpsSec_: uint48(
                vm.envOr("PAYMASTER_MIN_DELAY_SEC", uint256(0))
            )
        });

        // --- Step 5: Liquidity Seeding ---
        uint256 seedUsdc = vm.envOr("SEED_USDC", uint256(1_000_000e6));
        uint256 seedBnb = vm.envOr("SEED_BNB", uint256(5_000 ether));
        uint256 seedWavax = vm.envOr("SEED_WAVAX", uint256(1_000 ether));

        usdc.mint(deployer, seedUsdc * 2);
        bnb.mint(deployer, seedBnb * 2);
        tokenOut.deposit{value: seedWavax * 4}();

        // Seed USDC Pool
        usdc.approve(address(usdcPool), type(uint256).max);
        tokenOut.approve(address(usdcPool), type(uint256).max);
        usdcPool.addLiquidity(seedUsdc, seedWavax);

        // Seed BNB Pool
        bnb.approve(address(bnbPool), type(uint256).max);
        tokenOut.approve(address(bnbPool), type(uint256).max);
        bnbPool.addLiquidity(seedBnb, seedWavax);

        // --- Step 6: Paymaster Funding ---
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
            oracle: address(oracle),
            tokenOut: address(tokenOut),
            usdc: address(usdc),
            bnb: address(bnb),
            usdcPool: address(usdcPool),
            bnbPool: address(bnbPool)
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

        // Format the JSON content manually
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
            '  "oracle": "',
            vm.toString(d.oracle),
            '",\n',
            '  "tokenOut": "',
            vm.toString(d.tokenOut),
            '",\n',
            '  "usdc": "',
            vm.toString(d.usdc),
            '",\n',
            '  "bnb": "',
            vm.toString(d.bnb),
            '",\n',
            '  "usdcPool": "',
            vm.toString(d.usdcPool),
            '",\n',
            '  "bnbPool": "',
            vm.toString(d.bnbPool),
            '"\n',
            "}\n"
        );

        vm.writeFile(path, json);
        console2.log("Wrote deployments:", path);
    }
}

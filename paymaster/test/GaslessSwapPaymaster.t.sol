// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";

import "account-abstraction/core/EntryPoint.sol";
import "account-abstraction/interfaces/PackedUserOperation.sol";
import "account-abstraction/samples/SimpleAccountFactory.sol";
import "account-abstraction/samples/SimpleAccount.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../src/demo/TestERC20.sol";
import "../src/demo/WNative.sol";
import "../src/demo/DemoPool.sol";
import "../src/demo/DemoRouter.sol";
import "../src/GaslessSwapPaymaster.sol";

/**
 * @title GaslessSwapPaymasterTest
 * @dev Foundry test suite for the GaslessSwapPaymaster.
 *
 * Objectives:
 * 1. Verify that the Paymaster correctly validates swap-embedded UserOperations.
 * 2. Ensure the Paymaster only sponsors transactions when the user provides sufficient fees in tokenOut.
 * 3. Validate that the swap logic actually executes and funds the Paymaster's fee collection.
 */
contract GaslessSwapPaymasterTest is Test {
    // Core ERC-4337 Infrastructure
    EntryPoint internal entryPoint;
    SimpleAccountFactory internal factory;

    // Demo Swap Infrastructure
    TestERC20 internal usdc;
    WNative internal wavax;
    DemoPool internal pool;
    DemoRouter internal router;

    // The Paymaster under test
    GaslessSwapPaymaster internal paymaster;

    // Test account configuration
    uint256 internal ownerKey;
    address internal owner;
    uint256 internal salt;

    /**
     * @notice Global setup for all test cases.
     * Deploys the full stack and seeds initial liquidity and paymaster deposits.
     */
    function setUp() external {
        vm.deal(address(this), 10_000 ether);

        // Deploy AA Core
        entryPoint = new EntryPoint();
        factory = new SimpleAccountFactory(entryPoint);

        // Deploy Tokens
        usdc = new TestERC20("Test USDC", "tUSDC", 6);
        wavax = new WNative("Wrapped AVAX", "WAVAX");

        // Deploy Swap Infrastructure
        pool = new DemoPool(address(usdc), address(wavax), 30);
        router = new DemoRouter(pool);

        // Deploy and Configure Paymaster
        paymaster = new GaslessSwapPaymaster(
            entryPoint,
            router,
            address(usdc),
            address(wavax)
        );
        paymaster.setPolicy({
            gasBufferBps_: 500,
            fixedMarkupWei_: 0,
            minDepositWei_: 0,
            minDelayBetweenOpsSec_: 0
        });

        // Initialize the AMM
        _seedLiquidity();

        // Staking: fund paymaster deposit in EntryPoint so it can sponsor gas
        paymaster.deposit{value: 10 ether}();

        // Setup a dummy user account
        ownerKey = 0xA11CE;
        owner = vm.addr(ownerKey);
        salt = 0;
    }

    /**
     * @notice Test the primary "Gasless Swap" flow.
     * 1. User has USDC but no Native gas.
     * 2. User submits a UserOp to swap USDC -> WAVAX and pay the Paymaster in WAVAX.
     * 3. Paymaster validates and sponsors the gas.
     * 4. Script checks if Paymaster received the fee and user received the swapped tokens (minus fee).
     */
    function test_handleOps_happyPath_sponsorsAndCollectsFee() external {
        address sender = factory.getAddress(owner, salt);

        uint256 amountIn = 1_000e6; // 1000 USDC
        uint256 expectedOut = router.quoteExactIn(
            address(usdc),
            address(wavax),
            amountIn
        );
        uint256 minOut = (expectedOut * 9_950) / 10_000; // Allow 0.5% slippage
        uint256 feeAmount = 0.01 ether; // Manual fee for testing
        assertGe(minOut, feeAmount);

        // Mint initial USDC for the counterfactual account
        usdc.mint(sender, amountIn);

        // Construct the UserOperation with the batch: Approve -> Swap -> Transfer Fee
        PackedUserOperation memory op = _buildUserOp({
            sender: sender,
            owner: owner,
            salt: salt,
            amountIn: amountIn,
            minOut: minOut,
            feeAmount: feeAmount,
            deadline: block.timestamp + 60
        });

        // Cryptographically sign the operation
        bytes32 userOpHash = entryPoint.getUserOpHash(op);
        op.signature = _signUserOpHash(ownerKey, userOpHash);

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;

        // Snapshot balances
        uint256 paymasterFeeBefore = IERC20(address(wavax)).balanceOf(
            address(paymaster)
        );
        uint256 senderOutBefore = IERC20(address(wavax)).balanceOf(sender);

        // EXECUTION via EntryPoint
        entryPoint.handleOps(ops, payable(address(0xBEEF)));

        // Verification
        uint256 paymasterFeeAfter = IERC20(address(wavax)).balanceOf(
            address(paymaster)
        );
        uint256 senderOutAfter = IERC20(address(wavax)).balanceOf(sender);

        assertEq(
            paymasterFeeAfter - paymasterFeeBefore,
            feeAmount,
            "Paymaster did not receive fee"
        );
        assertGe(
            senderOutAfter - senderOutBefore,
            minOut - feeAmount,
            "Sender did not receive enough tokens"
        );
        assertEq(
            IERC20(address(usdc)).balanceOf(sender),
            0,
            "Input tokens were not fully spent"
        );
    }

    /**
     * @notice Ensures the Paymaster rejects operations where the provided fee is below policy limits.
     */
    function test_validate_revertsIfFeeTooLow() external {
        address sender = factory.getAddress(owner, salt);

        uint256 amountIn = 1_000e6;
        uint256 expectedOut = router.quoteExactIn(
            address(usdc),
            address(wavax),
            amountIn
        );
        uint256 minOut = (expectedOut * 9_900) / 10_000;
        uint256 deadline = block.timestamp + 60;

        PackedUserOperation memory op = _buildUserOp({
            sender: sender,
            owner: owner,
            salt: salt,
            amountIn: amountIn,
            minOut: minOut,
            feeAmount: 1, // Maliciously low fee
            deadline: deadline
        });

        bytes32 userOpHash = keccak256("dummy");
        uint256 maxCost = 0.001 ether;

        // Calculate expected requirement
        uint256 requiredFee = (maxCost * (10_000 + 500)) / 10_000;

        // Assert that the paymaster's validation logic reverts with FeeTooLow
        vm.expectRevert(
            abi.encodeWithSelector(
                GaslessSwapPaymaster.FeeTooLow.selector,
                requiredFee,
                1
            )
        );
        vm.prank(address(entryPoint));
        paymaster.validatePaymasterUserOp(op, userOpHash, maxCost);
    }

    /**
     * @dev Helper to seed the DemoPool with initial currency.
     */
    function _seedLiquidity() internal {
        // Mint token0 (USDC)
        usdc.mint(address(this), 2_000_000e6);

        // Mint token1 (WAVAX) by depositing native AVAX
        wavax.deposit{value: 2_000 ether}();

        usdc.approve(address(pool), type(uint256).max);
        wavax.approve(address(pool), type(uint256).max);

        pool.addLiquidity(1_000_000e6, 1_000 ether);
    }

    /**
     * @dev Helper to construct a standard 4337 UserOperation for this demo.
     */
    function _buildUserOp(
        address sender,
        address owner,
        uint256 salt,
        uint256 amountIn,
        uint256 minOut,
        uint256 feeAmount,
        uint256 deadline
    ) internal view returns (PackedUserOperation memory op) {
        address[] memory targets = new address[](3);
        uint256[] memory values = new uint256[](3);
        bytes[] memory datas = new bytes[](3);

        // 1. Approve router to spend user's USDC
        targets[0] = address(usdc);
        datas[0] = abi.encodeWithSelector(
            IERC20.approve.selector,
            address(router),
            amountIn
        );

        // 2. Perform the swap
        targets[1] = address(router);
        datas[1] = abi.encodeWithSelector(
            DemoRouter.swapExactIn.selector,
            address(usdc),
            address(wavax),
            amountIn,
            minOut,
            sender,
            deadline
        );

        // 3. Pay the Paymaster in swapped WAVAX
        targets[2] = address(wavax);
        datas[2] = abi.encodeWithSelector(
            IERC20.transfer.selector,
            address(paymaster),
            feeAmount
        );

        // Batch the calls into the SimpleAccount's executeBatch function
        bytes memory callData = abi.encodeWithSelector(
            SimpleAccount.executeBatch.selector,
            targets,
            values,
            datas
        );

        // Factory initialization call (for counterfactual accounts)
        bytes memory initCall = abi.encodeCall(
            SimpleAccountFactory.createAccount,
            (owner, salt)
        );
        bytes memory initCode = abi.encodePacked(address(factory), initCall);

        op.sender = sender;
        op.nonce = 0;
        op.initCode = initCode;
        op.callData = callData;

        // Set gas limits (generous for testing)
        uint256 verificationGasLimit = 2_000_000;
        uint256 callGasLimit = 2_000_000;
        op.accountGasLimits = bytes32(
            (verificationGasLimit << 128) | callGasLimit
        );
        op.preVerificationGas = 100_000;

        uint256 maxPriorityFeePerGas = 1 gwei;
        uint256 maxFeePerGas = 1 gwei;
        op.gasFees = bytes32((maxPriorityFeePerGas << 128) | maxFeePerGas);

        uint128 paymasterVerificationGasLimit = 200_000;
        uint128 paymasterPostOpGasLimit = 200_000;
        op.paymasterAndData = abi.encodePacked(
            address(paymaster),
            paymasterVerificationGasLimit,
            paymasterPostOpGasLimit
        );

        op.signature = "";
    }

    /**
     * @dev Simple ERC-191 signature helper.
     */
    function _signUserOpHash(
        uint256 privKey,
        bytes32 userOpHash
    ) internal returns (bytes memory sig) {
        bytes32 digest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, digest);
        return abi.encodePacked(r, s, v);
    }
}

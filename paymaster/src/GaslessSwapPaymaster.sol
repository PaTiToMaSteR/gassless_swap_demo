// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "account-abstraction/core/BasePaymaster.sol";
import "account-abstraction/core/Helpers.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./demo/DemoRouter.sol";
import "./demo/MockPriceOracle.sol";

/**
 * @title GaslessSwapPaymaster
 * @dev A paymaster contract that allows users to pay for transaction fees using an ERC20 token.
 *
 * How it works:
 * 1. The user creates a UserOperation that includes a batch of calls:
 *    a. Approve the Paymaster's router to spend the user's ERC20 tokens (`tokenIn`).
 *    b. Swap `tokenIn` for a fee-payment token (`tokenOut`) using the `DemoRouter`.
 *    c. Transfer the required fee in `tokenOut` to the Paymaster contract.
 * 2. In `_validatePaymasterUserOp`, the Paymaster decodes the UserOperation's `callData` to verify
 *    that these steps are present and that the quantities (swap amount, slippage, and fee) are correct.
 * 3. If validation passes, the Paymaster sponsors the transaction by deducting from its own
 *    deposit in the EntryPoint.
 * 4. After execution, `_postOp` updates internal accounting.
 *
 * This enables "gasless" swaps where the user doesn't need native gas tokens, provided they
 * have the required `tokenIn` to cover the transaction costs.
 */
contract GaslessSwapPaymaster is BasePaymaster {
    // Custom error definitions for gas efficiency and clarity
    error InvalidUserOpCallData();
    error UnsupportedRouter();
    error UnsupportedTokenPair();
    error FeeTooLow(uint256 requiredFee, uint256 providedFee);
    error MinOutTooLowForFee(uint256 minOut, uint256 feeAmount);
    error SlippageRisk(uint256 expectedOut, uint256 minOut);
    error DepositBelowMinimum(uint256 depositWei, uint256 minDepositWei);

    // Event emitted after post-operation processing
    event PostOpHandled(
        address indexed sender,
        bytes32 indexed userOpHash,
        PostOpMode mode,
        uint256 actualGasCostWei,
        uint256 actualUserOpFeePerGas,
        uint256 feeAmount
    );

    // Immutable state variables set during deployment
    DemoRouter public immutable router; // Router used for the swap
    MockPriceOracle public immutable oracle; // Oracle for price verification
    address public immutable tokenIn; // Token the user pays with
    address public immutable tokenOut; // Token the paymaster receives (assumed 1:1 with native gas)

    // Configurable policy settings
    uint256 public gasBufferBps = 500; // Extra buffer added to max gas cost (5%)
    uint256 public fixedMarkupWei = 0; // Optional flat fee added to every operation
    uint256 public minDepositWei = 0; // Minimum deposit required in EntryPoint to operate
    uint48 public minDelayBetweenOpsSec = 0; // Anti-spam delay between ops from same sender

    // Tracking for senders to enforce minDelayBetweenOpsSec
    mapping(address => uint48) public lastPostOpTs;

    // Statistics and accounting
    uint256 public sponsoredOps;
    uint256 public sponsoredOpsSucceeded;
    uint256 public sponsoredOpsReverted;
    uint256 public totalActualGasCostWei;
    uint256 public totalFeeAmount; // Accumulated fees in tokenOut

    /**
     * @notice Initializes the paymaster with required addresses.
     * @param entryPoint_ The official ERC-4337 EntryPoint address.
     * @param router_ The swap router instance.
     * @param tokenIn_ The token provided by the user.
     * @param tokenOut_ The token received by the paymaster.
     */
    constructor(
        IEntryPoint entryPoint_,
        DemoRouter router_,
        MockPriceOracle oracle_,
        address tokenIn_,
        address tokenOut_
    ) BasePaymaster(entryPoint_) {
        router = router_;
        oracle = oracle_;
        tokenIn = tokenIn_;
        tokenOut = tokenOut_;
    }

    /**
     * @notice Updates the paymaster's operational policies.
     * @dev Only the owner can call this.
     * @param gasBufferBps_ Percentage buffer for gas (e.g., 500 = 5%).
     * @param fixedMarkupWei_ Flat markup in wei added to the fee.
     * @param minDepositWei_ Minimum required balance to continue sponsoring.
     * @param minDelayBetweenOpsSec_ Cooldown period for senders.
     */
    function setPolicy(
        uint256 gasBufferBps_,
        uint256 fixedMarkupWei_,
        uint256 minDepositWei_,
        uint48 minDelayBetweenOpsSec_
    ) external onlyOwner {
        require(gasBufferBps_ <= 10_000, "gasBufferBps too high");
        gasBufferBps = gasBufferBps_;
        fixedMarkupWei = fixedMarkupWei_;
        minDepositWei = minDepositWei_;
        minDelayBetweenOpsSec = minDelayBetweenOpsSec_;
    }

    /**
     * @notice Validates that the paymaster is willing to pay for this UserOperation.
     * @dev Called by the EntryPoint. It decodes the user op's call data to ensure the
     * swap and fee payment logic is correctly embedded.
     * @param userOp The operation being validated.
     * @param userOpHash Hash of the operation.
     * @param maxCost The maximum potential gas cost in wei.
     * @return context Data to be passed to _postOp (sender, hash, fee amount).
     * @return validationData Packed validation data (authorizer, validUntil, validAfter).
     */
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    )
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        // Decode and validate the callData batch (Approve -> Swap -> Transfer)
        (
            uint256 feeAmount,
            uint256 swapAmountIn,
            uint256 minOut,
            uint256 deadline
        ) = _validateCallData(userOp.callData, userOp.sender);

        // Security check: ensure paymaster has enough deposit to cover max gas
        uint256 depositWei = getDeposit();
        if (depositWei < minDepositWei) {
            revert DepositBelowMinimum(depositWei, minDepositWei);
        }

        // Calculation check: ensure user is paying enough to cover predicted max cost
        uint256 requiredFee = _requiredFee(maxCost);
        if (feeAmount < requiredFee) {
            revert FeeTooLow(requiredFee, feeAmount);
        }

        // Slippage check: ensure the user's min output is at least as much as they pay in fees
        if (minOut < feeAmount) {
            revert MinOutTooLowForFee(minOut, feeAmount);
        }

        // Price check: verify the current on-chain quote matches user expectations (protection against frontrunning/stale data)
        uint256 expectedOut = router.quoteExactIn(
            tokenIn,
            tokenOut,
            swapAmountIn
        );
        if (expectedOut < minOut) {
            revert SlippageRisk(expectedOut, minOut);
        }

        // Oracle price check: ensure the fee offered is not significantly below the oracle price
        // requiredFeeOracle = (maxCostWei * (1 / oraclePrice)) ... basically we check if feeAmount in tokenOut
        // is enough to cover maxCost in Wei. Since tokenOut is 1:1 with Wei, we just compare.
        // But for tokenIn, we'd need oracle.getPrice(tokenIn).
        // For the demo, we'll verify the swapAmountIn provides enough tokenOut according to the oracle.
        uint256 oraclePriceInWei = oracle.getPrice(tokenIn);
        uint256 fairOut = (swapAmountIn * oraclePriceInWei) /
            (10 ** oracle.decimals(tokenIn));
        if (minOut < (fairOut * 95) / 100) {
            // allow 5% deviation from oracle
            revert SlippageRisk(fairOut, minOut);
        }

        // Time constraints: set op validity based on call deadline and sender cooldown
        uint48 validUntil = uint48(deadline);
        uint48 lastTs = lastPostOpTs[userOp.sender];
        uint48 validAfter = lastTs == 0 ? 0 : (lastTs + minDelayBetweenOpsSec);

        validationData = _packValidationData(false, validUntil, validAfter);
        context = abi.encode(userOp.sender, userOpHash, feeAmount);
    }

    /**
     * @notice Internal post-operation callback.
     * @dev Updates statistics and enforces anti-spam delay.
     * @param mode Success/Revert status of the user operation.
     * @param context Data passed from _validatePaymasterUserOp.
     * @param actualGasCost The real gas cost incurred.
     * @param actualUserOpFeePerGas The fee per gas unit paid.
     */
    function _postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) internal override {
        (address sender, bytes32 userOpHash, uint256 feeAmount) = abi.decode(
            context,
            (address, bytes32, uint256)
        );

        sponsoredOps++;
        totalActualGasCostWei += actualGasCost;
        lastPostOpTs[sender] = uint48(block.timestamp);

        // Update success/fail counters
        if (mode == PostOpMode.opSucceeded) {
            sponsoredOpsSucceeded++;
            totalFeeAmount += feeAmount;
        } else if (mode == PostOpMode.opReverted) {
            sponsoredOpsReverted++;
        }

        emit PostOpHandled(
            sender,
            userOpHash,
            mode,
            actualGasCost,
            actualUserOpFeePerGas,
            feeAmount
        );
    }

    /**
     * @notice Calculates the minimum fee required based on the maximum gas cost.
     * @param maxCost Estimated maximum gas cost.
     * @return The fee in tokenOut units.
     */
    function _requiredFee(uint256 maxCost) internal view returns (uint256) {
        // We assume tokenOut is roughly 1:1 with the native gas token.
        // We apply a multiplicative buffer (gasBufferBps) and an optional fixed markup.
        return (maxCost * (10_000 + gasBufferBps)) / 10_000 + fixedMarkupWei;
    }

    /**
     * @notice Inspects the UserOperation's callData to ensure it follows the expected batch format.
     * @dev Specifically looks for a 3-call batch to a SimpleAccount executeBatch(address[],uint256[],bytes[]).
     * @param callData The callData field from the UserOperation.
     * @param sender The address of the account sending the operation.
     * @return feeAmount The fee amount extracted from the transfer call.
     * @return amountIn The amount being swapped extracted from the router call.
     * @return minOut The minimum output required for the swap.
     * @return deadline The swap deadline.
     */
    function _validateCallData(
        bytes calldata callData,
        address sender
    )
        internal
        view
        returns (
            uint256 feeAmount,
            uint256 amountIn,
            uint256 minOut,
            uint256 deadline
        )
    {
        // 1. Verify callData length and selector for executeBatch
        if (callData.length < 4) revert InvalidUserOpCallData();
        bytes4 selector;
        assembly ("memory-safe") {
            selector := calldataload(callData.offset)
        }
        if (selector != bytes4(0x47e1da2a)) revert InvalidUserOpCallData();

        // 2. Decode executeBatch arguments
        (
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory datas
        ) = abi.decode(callData[4:], (address[], uint256[], bytes[]));

        // 3. Structural checks: Must be exactly 3 calls with zero value
        if (targets.length != 3 || datas.length != 3)
            revert InvalidUserOpCallData();
        if (!(values.length == 0 || values.length == 3))
            revert InvalidUserOpCallData();
        if (
            values.length == 3 &&
            (values[0] != 0 || values[1] != 0 || values[2] != 0)
        ) revert InvalidUserOpCallData();

        // 4. Validate Step 0: tokenIn.approve(router, amountIn)
        if (targets[0] != tokenIn) revert UnsupportedTokenPair();
        (bytes4 aSel, address spender, uint256 approveAmount) = _decodeApprove(
            datas[0]
        );
        if (aSel != IERC20.approve.selector) revert InvalidUserOpCallData();
        if (spender != address(router)) revert UnsupportedRouter();

        // 5. Validate Step 1: router.swapExactIn(tokenIn, tokenOut, amountIn, minOut, to=sender, deadline)
        if (targets[1] != address(router)) revert UnsupportedRouter();
        (
            address sTokenIn,
            address sTokenOut,
            uint256 sAmountIn,
            uint256 sMinOut,
            address to,
            uint256 sDeadline
        ) = _decodeSwapExactIn(datas[1]);

        if (sTokenIn != tokenIn || sTokenOut != tokenOut)
            revert UnsupportedTokenPair();
        if (to != sender) revert InvalidUserOpCallData();

        // 6. Validate Step 2: tokenOut.transfer(paymaster, feeAmount)
        if (targets[2] != tokenOut) revert UnsupportedTokenPair();
        (bytes4 tSel, address to2, uint256 feeAmount2) = _decodeTransfer(
            datas[2]
        );
        if (tSel != IERC20.transfer.selector) revert InvalidUserOpCallData();
        if (to2 != address(this)) revert InvalidUserOpCallData();

        // Cross-check: ensure the approved amount matches the swap amount
        if (approveAmount != sAmountIn) revert InvalidUserOpCallData();

        return (feeAmount2, sAmountIn, sMinOut, sDeadline);
    }

    /**
     * @notice Helper to decode an IERC20.approve call from bytes.
     */
    function _decodeApprove(
        bytes memory data
    ) internal pure returns (bytes4 sel, address spender, uint256 amount) {
        if (data.length != 4 + 32 + 32) revert InvalidUserOpCallData();
        sel = bytes4(data);
        (spender, amount) = abi.decode(_slice(data, 4), (address, uint256));
    }

    /**
     * @notice Helper to decode an IERC20.transfer call from bytes.
     */
    function _decodeTransfer(
        bytes memory data
    ) internal pure returns (bytes4 sel, address to, uint256 amount) {
        if (data.length != 4 + 32 + 32) revert InvalidUserOpCallData();
        sel = bytes4(data);
        (to, amount) = abi.decode(_slice(data, 4), (address, uint256));
    }

    /**
     * @notice Helper to decode a DemoRouter.swapExactIn call from bytes.
     */
    function _decodeSwapExactIn(
        bytes memory data
    )
        internal
        pure
        returns (
            address tIn,
            address tOut,
            uint256 amountIn,
            uint256 minOut,
            address to,
            uint256 deadline
        )
    {
        // Expected signature: swapExactIn(address,address,uint256,uint256,address,uint256)
        if (data.length != 4 + 32 * 6) revert InvalidUserOpCallData();
        bytes4 sel = bytes4(data);
        if (sel != DemoRouter.swapExactIn.selector)
            revert InvalidUserOpCallData();
        (tIn, tOut, amountIn, minOut, to, deadline) = abi.decode(
            _slice(data, 4),
            (address, address, uint256, uint256, address, uint256)
        );
    }

    /**
     * @notice Slices a bytes array.
     * @param data The array to slice.
     * @param start The starting index.
     * @return out The sliced array.
     */
    function _slice(
        bytes memory data,
        uint256 start
    ) private pure returns (bytes memory out) {
        if (start > data.length) revert InvalidUserOpCallData();
        unchecked {
            uint256 len = data.length - start;
            out = new bytes(len);
            for (uint256 i = 0; i < len; i++) {
                out[i] = data[i + start];
            }
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./DemoPool.sol";

/**
 * @title DemoRouter
 * @dev A simple router to interact with the DemoPool.
 *
 * Production routers (like UniSwap V2 Router) typically handle multi-hop swaps,
 * liquidity provisioning, and gas-efficient wrapping/unwrapping of native assets.
 *
 * This Demo version:
 * 1. Provides a more user-friendly interface for swapping against a specific pool.
 * 2. Handles the safe transfer of tokens from the user to the pool for a swap.
 * 3. Enforces swap deadlines to protect against stale transactions.
 */
contract DemoRouter {
    // Event emitted on successful swaps
    event Swap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address to
    );

    // Immutable reference to the underlying pool and its pair
    DemoPool public immutable pool;
    address public immutable token0;
    address public immutable token1;

    /**
     * @notice Initializes the router with a target pool.
     * @param pool_ The DemoPool instance this router will trade against.
     */
    constructor(DemoPool pool_) {
        pool = pool_;
        token0 = pool_.token0();
        token1 = pool_.token1();
    }

    /**
     * @notice Fetches a price quote for a swap.
     * @param tokenIn The token provided.
     * @param tokenOut The token desired.
     * @param amountIn The amount of tokenIn.
     * @return amountOut The expected amount of tokenOut received.
     */
    function quoteExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        _requireSupportedPair(tokenIn, tokenOut);
        return pool.quoteExactIn(tokenIn, amountIn);
    }

    /**
     * @notice Executes a swap from tokenIn to tokenOut.
     * @dev User MUST have granted ERC20 approval to this Router before calling this.
     * @param tokenIn Asset being sold.
     * @param tokenOut Asset being bought.
     * @param amountIn Input amount.
     * @param minOut Minimum output required.
     * @param to Recipient of the tokens.
     * @param deadline Unix timestamp after which the trade will revert.
     * @return amountOut The actual quantity received by 'to'.
     */
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        // Stop execution if the transaction has been pending for too long
        require(block.timestamp <= deadline, "DemoRouter: expired");

        // Ensure the tokens requested are actually in the pool
        _requireSupportedPair(tokenIn, tokenOut);

        // 1. Pull tokens from the user to the pool directly
        IERC20(tokenIn).transferFrom(msg.sender, address(pool), amountIn);

        // 2. Instruct the pool to perform the swap and send tokens to the recipient
        amountOut = pool.swapExactIn(tokenIn, amountIn, minOut, to);

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut, to);
    }

    /**
     * @dev Internal sanity check to verify the pair matches the pool's configuration.
     */
    function _requireSupportedPair(
        address tokenIn,
        address tokenOut
    ) internal view {
        bool ok = (tokenIn == token0 && tokenOut == token1) ||
            (tokenIn == token1 && tokenOut == token0);
        require(ok, "DemoRouter: unsupported pair");
    }
}

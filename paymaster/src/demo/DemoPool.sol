// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DemoPool
 * @dev A simplified Automated Market Maker (AMM) pool supporting a single token pair.
 *
 * This pool uses the Constant Product formula (x * y = k) for price discovery.
 * It is intended for demonstration purposes and lacks many features of production AMMs
 * like UniSwap (e.g., LP tokens, price oracles, or re-entrancy guards).
 *
 * Flow:
 * 1. Liquidity providers call `addLiquidity` to seed the pool.
 * 2. Traders call `swapExactIn` to exchange one token for another.
 * 3. The pool collects a configurable fee (defaulting to 30 bps) on every swap.
 */
contract DemoPool {
    // Events for tracking pool activity
    event LiquidityAdded(
        address indexed provider,
        uint256 amount0,
        uint256 amount1
    );
    event SwapExactIn(
        address indexed sender,
        address indexed tokenIn,
        uint256 amountIn,
        address indexed to,
        uint256 amountOut
    );

    // Immutable token addresses for the pair
    address public immutable token0;
    address public immutable token1;

    // Current internal balances (reserves) of the tokens
    uint256 public reserve0;
    uint256 public reserve1;

    // Swap fee in Basis Points (1 bp = 0.01%)
    uint256 public immutable feeBps;

    /**
     * @notice Initializes the pool with a pair of tokens and a fee.
     * @param token0_ Address of the first token.
     * @param token1_ Address of the second token.
     * @param feeBps_ Fee in basis points (e.g., 30 = 0.3%).
     */
    constructor(address token0_, address token1_, uint256 feeBps_) {
        require(
            token0_ != address(0) && token1_ != address(0),
            "DemoPool: zero token"
        );
        require(token0_ != token1_, "DemoPool: same token");
        require(feeBps_ <= 1000, "DemoPool: fee too high");
        token0 = token0_;
        token1 = token1_;
        feeBps = feeBps_;
    }

    /**
     * @notice Returns the current liquid reserves of the pool.
     */
    function getReserves()
        external
        view
        returns (uint256 _reserve0, uint256 _reserve1)
    {
        return (reserve0, reserve1);
    }

    /**
     * @notice Adds liquidity to the pool.
     * @dev Transfers tokens from the caller and updates reserves.
     * In this demo, no LP tokens are minted; liquidity is assumed to be provided by the deployer.
     * @param amount0 Amount of token0 to add.
     * @param amount1 Amount of token1 to add.
     */
    function addLiquidity(uint256 amount0, uint256 amount1) external {
        require(amount0 != 0 && amount1 != 0, "DemoPool: zero liquidity");

        // Collect tokens from the provider
        IERC20(token0).transferFrom(msg.sender, address(this), amount0);
        IERC20(token1).transferFrom(msg.sender, address(this), amount1);

        // Update internal accounting
        reserve0 += amount0;
        reserve1 += amount1;

        emit LiquidityAdded(msg.sender, amount0, amount1);
    }

    /**
     * @notice Calculates the output amount for a given input based on current reserves.
     * @param tokenIn The address of the token being provided.
     * @param amountIn The amount of tokenIn being swapped.
     * @return amountOut The calculated output amount after fees.
     */
    function quoteExactIn(
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        return _getAmountOut(tokenIn, amountIn, reserve0, reserve1);
    }

    /**
     * @notice Performs a swap of tokenIn for tokenOut.
     * @dev Updates reserves and transfers the output token to the recipient.
     * @param tokenIn The token being provided.
     * @param amountIn The input amount.
     * @param minOut The minimum acceptable output (slippage protection).
     * @param to The recipient of the output tokens.
     * @return amountOut The actual amount of tokens sent.
     */
    function swapExactIn(
        address tokenIn,
        uint256 amountIn,
        uint256 minOut,
        address to
    ) external returns (uint256 amountOut) {
        require(amountIn != 0, "DemoPool: zero amount");
        require(to != address(0), "DemoPool: zero to");

        // Identify which reserve is 'input' and which is 'output'
        (uint256 rIn, uint256 rOut, address tokenOut) = _selectReserves(
            tokenIn
        );

        // Calculate price based on x * y = k
        amountOut = _getAmountOutGivenReserves(amountIn, rIn, rOut);
        require(amountOut >= minOut, "DemoPool: slippage");

        // Update state variables based on the swap direction
        if (tokenIn == token0) {
            reserve0 = rIn + amountIn;
            reserve1 = rOut - amountOut;
        } else {
            reserve1 = rIn + amountIn;
            reserve0 = rOut - amountOut;
        }

        // Send tokens to recipient
        IERC20(tokenOut).transfer(to, amountOut);
        emit SwapExactIn(msg.sender, tokenIn, amountIn, to, amountOut);
    }

    /**
     * @dev Internal helper to map token addresses to the correct reserve variables.
     */
    function _selectReserves(
        address tokenIn
    ) internal view returns (uint256 rIn, uint256 rOut, address tokenOut) {
        if (tokenIn == token0) {
            return (reserve0, reserve1, token1);
        }
        if (tokenIn == token1) {
            return (reserve1, reserve0, token0);
        }
        revert("DemoPool: token not in pool");
    }

    /**
     * @dev Internal helper for quoting, allowing for prospective reserve values.
     */
    function _getAmountOut(
        address tokenIn,
        uint256 amountIn,
        uint256 r0,
        uint256 r1
    ) internal view returns (uint256 amountOut) {
        (uint256 rIn, uint256 rOut, ) = _selectReservesWith(tokenIn, r0, r1);
        return _getAmountOutGivenReserves(amountIn, rIn, rOut);
    }

    /**
     * @dev Internal helper to map arbitrary reserve values to input/output based on token direction.
     */
    function _selectReservesWith(
        address tokenIn,
        uint256 r0,
        uint256 r1
    ) internal view returns (uint256 rIn, uint256 rOut, address tokenOut) {
        if (tokenIn == token0) return (r0, r1, token1);
        if (tokenIn == token1) return (r1, r0, token0);
        revert("DemoPool: token not in pool");
    }

    /**
     * @dev Core AMM logic using the constant product invariant: (x + dx) * (y - dy) = x * y
     * Solving for dy: dy = (y * dx_after_fee) / (x + dx_after_fee)
     */
    function _getAmountOutGivenReserves(
        uint256 amountIn,
        uint256 rIn,
        uint256 rOut
    ) internal view returns (uint256 amountOut) {
        require(rIn != 0 && rOut != 0, "DemoPool: empty reserves");

        // Apply swap fee
        uint256 amountInWithFee = amountIn * (10_000 - feeBps);
        uint256 numerator = amountInWithFee * rOut;
        uint256 denominator = (rIn * 10_000) + amountInWithFee;
        amountOut = numerator / denominator;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockPriceOracle
 * @notice Simple oracle for the demo to provide token prices relative to native ETH/WAVAX.
 */
contract MockPriceOracle is Ownable {
    mapping(address => uint256) public prices; // price of 1 token in Wei
    mapping(address => uint8) public decimals;

    event PriceUpdated(address indexed token, uint256 price);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Set the price of a token in Wei.
     * @param token Address of the token.
     * @param priceInWei Price of 1 standard unit of the token (e.g. 1 USDC) in Wei.
     * @param decimals_ Decimals of the token.
     */
    function setPrice(
        address token,
        uint256 priceInWei,
        uint8 decimals_
    ) external onlyOwner {
        prices[token] = priceInWei;
        decimals[token] = decimals_;
        emit PriceUpdated(token, priceInWei);
    }

    /**
     * @notice Get the price of a token in Wei.
     * @param token Address of the token.
     */
    function getPrice(address token) external view returns (uint256) {
        uint256 price = prices[token];
        require(price > 0, "Oracle: price not set");
        return price;
    }
}

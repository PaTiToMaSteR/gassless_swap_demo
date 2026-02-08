// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title WNative
 * @dev A simplified wrapper for native gas tokens (e.g., WETH, WAVAX).
 *
 * Users deposit native tokens to receive an equivalent 1:1 amount of the ERC20 representation.
 * This is essential for DeFi protocols (like our DemoPool) that require the ERC20 interface.
 */
contract WNative is ERC20 {
    // Events for tracking wrapping and unwrapping activity
    event Deposit(address indexed from, uint256 amount);
    event Withdrawal(address indexed to, uint256 amount);

    /**
     * @notice Initializes the token with standard name/symbol.
     */
    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {}

    /**
     * @dev Fallback to handle direct native transfers (e.g., from an exchange or wallet).
     */
    receive() external payable {
        deposit();
    }

    /**
     * @notice Wraps native tokens into ERC20.
     * @dev Requires msg.value > 0.
     */
    function deposit() public payable {
        require(msg.value != 0, "WNative: zero deposit");
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @notice Unwraps ERC20 tokens back into native gas tokens.
     * @param amount The quantity to burn and return as native.
     */
    function withdraw(uint256 amount) external {
        require(amount != 0, "WNative: zero withdraw");

        // 1. Burn the wrapper tokens from the user
        _burn(msg.sender, amount);

        // 2. Return the physical native gas to the caller
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "WNative: withdraw failed");

        emit Withdrawal(msg.sender, amount);
    }
}

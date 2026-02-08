// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestERC20
 * @dev A basic ERC20 token for testing purposes with configurable decimals and a public minting function.
 */
contract TestERC20 is ERC20 {
    // Custom decimals storage
    uint8 private immutable _decimals;

    /**
     * @notice Deployment constructor.
     * @param name_ Token name.
     * @param symbol_ Token symbol.
     * @param decimals_ Number of decimals (e.g., 6 for USDC simulation).
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    /**
     * @notice Overrides the default OpenZeppelin decimals (18).
     */
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Allows anyone to mint tokens for testing.
     * @param to Recipient address.
     * @param amount Quantity to mint.
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

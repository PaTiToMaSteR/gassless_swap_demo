import { ethers, BigNumber } from "ethers";
import { describe, expect, it } from "vitest";
import { encodeEIP7702Transaction, signEIP7702Transaction } from "../src/packing";

describe("EIP-7702 Encoding & Signing", () => {
    const mnemonic = "test test test test test test test test test test test junk";
    const wallet = ethers.Wallet.fromMnemonic(mnemonic);
    const target = "0x" + "11".repeat(20);

    it("encodes Type 4 transaction RLP correctly", () => {
        const tx = {
            chainId: 31337,
            nonce: 0,
            maxPriorityFeePerGas: ethers.utils.parseUnits("1", "gwei"),
            maxFeePerGas: ethers.utils.parseUnits("2", "gwei"),
            gasLimit: BigNumber.from(21000),
            to: target,
            value: BigNumber.from(0),
            data: "0x",
            accessList: [],
            authorizationList: [
                {
                    chainId: "0x7a69",
                    address: target,
                    nonce: "0x0",
                    v: "0x1b",
                    r: "0x" + "aa".repeat(32),
                    s: "0x" + "bb".repeat(32)
                }
            ]
        };

        const signature = {
            v: 0,
            r: "0x" + "cc".repeat(32),
            s: "0x" + "dd".repeat(32)
        };

        const encoded = encodeEIP7702Transaction(tx as any, signature);
        expect(encoded).toMatch(/^0x04/);

        const payload = encoded.slice(4);
        const decoded = ethers.utils.RLP.decode("0x" + payload);

        // [chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, to, value, data, access_list, authorization_list, signature_y_parity, signature_r, signature_s]
        expect(decoded.length).toBe(13);
        expect(BigNumber.from(decoded[0]).toNumber()).toBe(31337);
        expect(decoded[5].toLowerCase()).toBe(target.toLowerCase());
        expect(decoded[9].length).toBe(1); // 1 authorization
        expect(decoded[9][0][1].toLowerCase()).toBe(target.toLowerCase());
    });

    it("signs and encodes a Type 4 transaction", async () => {
        const tx = {
            chainId: 31337,
            nonce: 5,
            maxPriorityFeePerGas: ethers.utils.parseUnits("1", "gwei"),
            maxFeePerGas: ethers.utils.parseUnits("2", "gwei"),
            gasLimit: BigNumber.from(1000000),
            to: target,
            value: BigNumber.from(0),
            data: "0xabcdef",
            accessList: [],
            authorizationList: []
        };

        const signedRaw = await signEIP7702Transaction(wallet, tx);
        expect(signedRaw).toMatch(/^0x04/);

        const decoded = ethers.utils.RLP.decode("0x" + signedRaw.slice(4));
        expect(BigNumber.from(decoded[1]).toNumber()).toBe(5);
        expect(decoded[7]).toBe("0xabcdef");
    });
});

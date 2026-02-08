import { describe, expect, it } from "vitest";
import { ethers } from "ethers";

import { makeNonRevertingDummySignature } from "./userop";

describe("makeNonRevertingDummySignature", () => {
  it("creates a 65-byte signature that ethers can recover (no throw)", () => {
    const sig = makeNonRevertingDummySignature();
    const bytes = ethers.utils.arrayify(sig);
    expect(bytes.length).toBe(65);

    const split = ethers.utils.splitSignature(sig);
    expect([27, 28]).toContain(split.v);

    const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("dummy"));
    const recovered = ethers.utils.recoverAddress(hash, sig);
    expect(recovered).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(recovered).not.toBe(ethers.constants.AddressZero);
  });
});


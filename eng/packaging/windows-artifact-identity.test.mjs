import { describe, expect, it } from "vitest";
import {
  assertSameArtifactBytes,
  assertWindowsArtifactSigner,
  normalizeWindowsSignerThumbprint
} from "./windows-artifact-identity.mjs";

describe("Windows artifact identity", () => {
  it("normalizes only exact SHA-1 certificate thumbprints", () => {
    expect(normalizeWindowsSignerThumbprint("ab".repeat(20))).toBe("AB".repeat(20));
    for (const invalid of ["", "A".repeat(39), "G".repeat(40), "A".repeat(41), undefined]) {
      expect(() => normalizeWindowsSignerThumbprint(invalid)).toThrow("40 hexadecimal");
    }
  });

  it("binds expected Publisher identity and exact candidate bytes", () => {
    const signer = "AB".repeat(20);
    const identity = {
      byteLength: 100,
      sha256: "1".repeat(64),
      authenticode: { status: "Valid", signerThumbprint: signer }
    };
    expect(assertWindowsArtifactSigner(identity, signer)).toBe(identity);
    expect(() => assertWindowsArtifactSigner(identity, "CD".repeat(20)))
      .toThrow("unexpected Windows Publisher");
    expect(() => assertSameArtifactBytes(identity, { ...identity, sha256: "2".repeat(64) }))
      .toThrow("do not match the packaged release candidate");
  });
});

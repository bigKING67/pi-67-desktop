import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyOpenVikingManifest } from "./openviking-runtime-manifest.mjs";

const expected = {
  platform: "darwin", arch: "arm64", pythonVersion: "3.12.10",
  openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: "a".repeat(64)
};
const keys = generateKeyPairSync("ed25519");
const bytes = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", ...expected }));

describe("OpenViking signed runtime manifest", () => {
  it("accepts exact bytes only under the independently trusted key", () => {
    const signature = sign(null, bytes, keys.privateKey);
    expect(() => verifyOpenVikingManifest(bytes, signature, keys.publicKey, expected)).not.toThrow();
    const other = generateKeyPairSync("ed25519");
    expect(() => verifyOpenVikingManifest(bytes, signature, other.publicKey, expected)).toThrow(/signature/u);
    expect(() => verifyOpenVikingManifest(Buffer.concat([bytes, Buffer.from(" ")]), signature, keys.publicKey, expected))
      .toThrow(/signature/u);
  });

  it("rejects signed target, version or content drift", () => {
    const signature = sign(null, bytes, keys.privateKey);
    for (const drift of [{ platform: "win32" }, { arch: "x64" }, { pythonVersion: "3.13.0" },
      { openvikingVersion: "0.4.15" }, { sdkVersion: "0.1.9" }, { treeSha256: "b".repeat(64) }]) {
      expect(() => verifyOpenVikingManifest(bytes, signature, keys.publicKey, { ...expected, ...drift }))
        .toThrow(/identity/u);
    }
  });

  it("rejects malformed, oversized and self-keyed manifests even when signed", () => {
    for (const content of ["null", "[]", "{", " ".repeat(8_193),
      JSON.stringify({ schema: "new-money.openviking-runtime.v1", ...expected, publicKey: "untrusted" })]) {
      const invalid = Buffer.from(content);
      expect(() => verifyOpenVikingManifest(invalid, sign(null, invalid, keys.privateKey), keys.publicKey, expected)).toThrow();
    }
    expect(() => verifyOpenVikingManifest(bytes, Buffer.alloc(63), keys.publicKey, expected)).toThrow(/signature/u);
  });
});

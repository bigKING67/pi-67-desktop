import { verify, type KeyObject } from "node:crypto";

interface OpenVikingRuntimeIdentity {
  platform: string;
  arch: string;
  pythonVersion: string;
  openvikingVersion: string;
  sdkVersion: string;
  treeSha256: string;
}

/** Caller supplies the trusted key and freshly measured tree, never the manifest. */
export function verifyOpenVikingManifest(
  bytes: Buffer,
  signature: Buffer,
  trustedKey: KeyObject,
  expected: OpenVikingRuntimeIdentity
): void {
  if (bytes.length === 0 || bytes.length > 8_192 || signature.length !== 64
    || trustedKey.type !== "public" || trustedKey.asymmetricKeyType !== "ed25519"
    || !verify(null, bytes, trustedKey, signature)) {
    throw new Error("OpenViking runtime signature is invalid.");
  }
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error("OpenViking runtime manifest is invalid."); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("OpenViking runtime manifest is invalid.");
  }
  const manifest = value as Record<string, unknown>;
  const keys = ["schema", "platform", "arch", "pythonVersion", "openvikingVersion", "sdkVersion", "treeSha256"];
  if (Object.keys(manifest).length !== keys.length
    || !Object.keys(manifest).every((key) => keys.includes(key))
    || manifest.schema !== "new-money.openviking-runtime.v1"
    || !/^[a-f0-9]{64}$/u.test(expected.treeSha256)
    || !Object.entries(expected).every(([key, expectedValue]) => manifest[key] === expectedValue)) {
    throw new Error("OpenViking runtime identity does not match the approved target.");
  }
}

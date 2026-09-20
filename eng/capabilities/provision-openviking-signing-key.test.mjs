import { createHash, createPublicKey } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { provisionOpenVikingSigningKey } from "./provision-openviking-signing-key.mjs";

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function root() { const value = await mkdtemp(join(tmpdir(), "new-money-signing-test-")); roots.push(value); return value; }

describe.skipIf(process.platform === "win32")("operator-only signing key provisioning", () => {
  it("creates owner-private keys, verifies persisted signatures and returns only public metadata", async () => {
    const parent = await root(); const target = join(parent, "signing");
    const receipt = await provisionOpenVikingSigningKey(target);
    expect(receipt).toMatchObject({ algorithm: "Ed25519", selfTest: "PASS", deployment: "NOT_PERFORMED",
      storage: "UNENCRYPTED_PKCS8_OWNER_ONLY" });
    expect((await lstat(target)).mode & 0o077).toBe(0);
    for (const name of await readdir(target)) expect((await lstat(join(target, name))).mode & 0o077).toBe(0);
    const publicKey = createPublicKey(await readFile(join(target, "openviking-ed25519-public.pem")));
    expect(receipt.fingerprintSha256).toBe(createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex"));
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE KEY");
    const before = await readFile(join(target, "key-metadata.json"));
    await expect(provisionOpenVikingSigningKey(target)).rejects.toThrow();
    expect(await readFile(join(target, "key-metadata.json"))).toEqual(before);
  });
  it("rejects relative, broad and linked targets without altering existing content", async () => {
    const parent = await root(); const link = join(parent, "link");
    await symlink(parent, link);
    for (const target of ["relative", "/", link]) await expect(provisionOpenVikingSigningKey(target)).rejects.toThrow();
    expect(await readdir(parent)).toEqual(["link"]);
  });
});

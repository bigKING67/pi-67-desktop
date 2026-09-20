import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adoptSignedOpenVikingInstallation, signOpenVikingLocalInstallation } from "./sign-openviking-local-installation.mjs";
import { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mts";

const trust = vi.hoisted(() => ({ key: undefined }));
vi.mock("../../apps/desktop/src/openviking-runtime-trust.ts", () => ({ openVikingRuntimeTrustedKey: () => trust.key }));
const roots = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-local-sign-")); roots.push(root);
  const source = join(root, "runtime"); const output = join(root, "output"); const secret = join(root, "secret");
  await mkdir(source); await mkdir(output); await mkdir(secret, { mode: 0o700 });
  await writeFile(join(source, "fixture"), "synthetic-runtime");
  const pair = generateKeyPairSync("ed25519"); trust.key = pair.publicKey;
  const keyPath = join(secret, "key.pem");
  await writeFile(keyPath, pair.privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  const tree = await runtimeTreeIdentity(source);
  return { source, output, keyPath, tree };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")("local signed installation", () => {
  it("adopts a verified historical tree without a private key and reuses its exact identity", async () => {
    const { source, output, keyPath, tree } = await fixture();
    const first = await signOpenVikingLocalInstallation(source, tree.sha256, output, keyPath);
    const marker = join(first.installationRoot, "native-artifact.json");
    await rm(marker); await rm(keyPath);
    expect(await adoptSignedOpenVikingInstallation(first.installationRoot, tree.sha256)).toMatchObject({ adopted: false, purpose: "private" });
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await adoptSignedOpenVikingInstallation(first.installationRoot, tree.sha256, true)).toMatchObject({ adopted: true });
    expect(JSON.parse(await readFile(marker, "utf8"))).toMatchObject({ kind: "signed", status: "READY", value: { status: "PASS" } });
    expect((await runtimeTreeIdentity(join(first.installationRoot, "runtime"))).sha256).toBe(tree.sha256);
    await expect(adoptSignedOpenVikingInstallation(first.installationRoot, tree.sha256, true)).rejects.toThrow("ownership");
  });
  it.each(["signature", "tree", "receipt", "lock"])("does not adopt historical outputs with invalid %s", async kind => {
    const { source, output, keyPath, tree } = await fixture();
    const first = await signOpenVikingLocalInstallation(source, tree.sha256, output, keyPath);
    const marker = join(first.installationRoot, "native-artifact.json"); await rm(marker);
    if (kind === "signature") await writeFile(join(first.installationRoot, "manifest.sig"), Buffer.alloc(64));
    if (kind === "tree") await writeFile(join(first.installationRoot, "runtime/fixture"), "changed");
    if (kind === "receipt") await writeFile(join(first.installationRoot, "assembly-receipt.json"), "{}");
    if (kind === "lock") await writeFile(join(output, ".native-artifacts.lock"), "busy");
    await expect(adoptSignedOpenVikingInstallation(first.installationRoot, tree.sha256, true)).rejects.toThrow();
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("uses external signing material without copying it or changing the source", async () => {
    const { source, output, keyPath, tree } = await fixture();
    const result = await signOpenVikingLocalInstallation(source, tree.sha256, output, keyPath);
    expect(result).toMatchObject({ status: "PASS", signatureVerification: "SOURCE_PINNED_KEY_PASS", productionRelease: "NOT_PERFORMED" });
    expect((await readdir(result.installationRoot)).sort()).toEqual(["assembly-receipt.json", "manifest.json", "manifest.sig", "native-artifact.json", "runtime"]);
    expect((await runtimeTreeIdentity(source)).sha256).toBe(tree.sha256);
    expect(await readFile(join(result.installationRoot, "assembly-receipt.json"), "utf8")).not.toContain("PRIVATE KEY");
  });
  it("reuses a signed tree only after rechecking its bytes and signature", async () => {
    const { source, output, keyPath, tree } = await fixture();
    const first = await signOpenVikingLocalInstallation(source, tree.sha256, output, keyPath);
    const reused = await signOpenVikingLocalInstallation(source, tree.sha256, output, keyPath);
    expect(reused.installationRoot).toBe(first.installationRoot);
    expect(reused.artifactReuse).toBe("VERIFIED_EXISTING");
    expect(await readdir(output)).toHaveLength(1);
    await writeFile(join(first.installationRoot, "manifest.sig"), Buffer.alloc(64));
    await expect(signOpenVikingLocalInstallation(source, tree.sha256, output, keyPath)).rejects.toThrow();
    expect(await readdir(output)).toHaveLength(1);
  });
  it.each(["key", "permissions", "symlink", "tree", "output", "embedded-key"])("rejects %s before creating output", async (kind) => {
    const { source, output, keyPath, tree } = await fixture();
    let selectedKey = keyPath;
    if (kind === "key") trust.key = generateKeyPairSync("ed25519").publicKey;
    if (kind === "permissions") await chmod(keyPath, 0o644);
    if (kind === "symlink") { selectedKey = join(keyPath, "../linked.pem"); await symlink(keyPath, selectedKey); }
    if (kind === "embedded-key") { selectedKey = join(source, "key.pem"); await writeFile(selectedKey, await readFile(keyPath), { mode: 0o600 }); }
    await expect(signOpenVikingLocalInstallation(source, kind === "tree" ? "0".repeat(64) : tree.sha256,
      kind === "output" ? source : output, selectedKey)).rejects.toThrow();
    expect(await readdir(output)).toEqual([]);
  });
});

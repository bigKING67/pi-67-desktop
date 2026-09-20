import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { assembleOpenVikingTestInstallation } from "./assemble-openviking-test-installation.mjs";
import { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mts";

const roots = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-test-assembly-")); roots.push(root);
  const source = join(root, "source"); const output = join(root, "output");
  await mkdir(join(source, "bin"), { recursive: true }); await mkdir(output);
  await writeFile(join(source, "bin/python3.12"), "synthetic-runtime");
  return { source, output, tree: await runtimeTreeIdentity(source) };
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")("test-only installation assembly", () => {
  it("round-trips the installed format without persisting test keys or changing the source", async () => {
    const { source, output, tree } = await fixture();
    const result = await assembleOpenVikingTestInstallation(source, tree.sha256, output);
    expect(result).toMatchObject({ status: "PASS", signatureVerification: "EPHEMERAL_TEST_KEY_ONLY", productionAdmission: "UNVERIFIED", tree });
    expect((await runtimeTreeIdentity(source)).sha256).toBe(tree.sha256);
    expect((await readdir(result.installationRoot)).sort()).toEqual(["assembly-receipt.json", "manifest.json", "manifest.sig", "runtime"]);
    expect((await readFile(join(result.installationRoot, "manifest.sig"))).length).toBe(64);
    expect(JSON.parse(await readFile(result.receiptPath, "utf8")).status).toBe("PASS");
  });
  it("rejects source drift and recursive output before creating an installation", async () => {
    const { source, output, tree } = await fixture();
    await expect(assembleOpenVikingTestInstallation(source, "0".repeat(64), output)).rejects.toThrow(/verified tree/);
    expect(await readdir(output)).toEqual([]);
    await expect(assembleOpenVikingTestInstallation(source, tree.sha256, source)).rejects.toThrow(/outside/);
  });
});

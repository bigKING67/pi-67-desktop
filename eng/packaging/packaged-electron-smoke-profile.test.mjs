import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { preparePackagedSmokeProfile } from "./packaged-electron-smoke-profile.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("packaged Electron smoke profile", () => {
  it("isolates a direct native MCP fixture and leaves the retired adapter as a throwing load sentinel", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-packaged-profile-"));
    roots.push(root);
    const agentDir = join(root, "agent");
    const extensionsDirectory = join(agentDir, "extensions");
    const workspace = join(root, "workspace");
    const resourcesPath = join(root, "resources");
    const privateNode = join(resourcesPath, "toolchain", "node", "bin", "node");
    await Promise.all([
      mkdir(extensionsDirectory, { recursive: true }),
      mkdir(workspace, { recursive: true }),
      mkdir(join(resourcesPath, "toolchain", "node", "bin"), { recursive: true })
    ]);
    await Promise.all([
      writeFile(privateNode, "fixture", "utf8"),
      writeFile(join(resourcesPath, "toolchain", "manifest.json"), JSON.stringify({
        paths: { node: "node/bin/node" }
      }), "utf8")
    ]);

    const profile = await preparePackagedSmokeProfile({
      agentDir,
      artifact: { resourcesPath },
      extensionsDirectory,
      userDataDirectory: root,
      workspace
    });

    const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
    const mcp = JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8"));
    expect(settings.packages).toContain("npm:pi-mcp-adapter");
    await expect(readFile(join(agentDir, "npm", "node_modules", "pi-mcp-adapter", "index.js"), "utf8"))
      .resolves.toContain("must never load");
    expect(mcp.mcpServers.packaged_native).toMatchObject({ command: privateNode, exposure: "direct" });
    expect(profile.nativeMcp).toHaveProperty("evidencePath");
    expect(profile.nativeMcp).toHaveProperty("processReceiptPath");
  });
});

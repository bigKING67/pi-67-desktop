import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSessionServices, SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { createDesktopPackageSettingsView } from "./desktop-package-toolchain.js";

const temporaryDirectories: string[] = [];
const environment = {
  PI67_DESKTOP: "1",
  PI67_PACKAGED: "1",
  PI67_TOOLCHAIN_ROOT: "/app/toolchain",
  PI67_NODE_EXECUTABLE: "/app/toolchain/node/bin/node",
  PI67_NPM_CLI: "/app/toolchain/npm/bin/npm-cli.js",
  PI67_GIT_EXECUTABLE: "/app/toolchain/git/bin/git",
  PI67_GIT_EXEC_PATH: "/app/toolchain/git/libexec/git-core",
  PI67_MANAGED_CAPABILITIES_ROOT: "/app/agent/desktop-capabilities",
  PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([])
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("retired MCP adapter filter", () => {
  it("keeps a bare local adapter package and explicit extension out of Pi's ResourceLoader", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-retired-mcp-adapter-bare-loader-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const workspace = join(root, "workspace");
    const adapterRoot = join(agentDir, "legacy-adapter");
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(join(adapterRoot, "extensions"), { recursive: true })
    ]);
    await Promise.all([
      writeFile(join(adapterRoot, "package.json"), JSON.stringify({ name: "pi-mcp-adapter" })),
      writeFile(join(adapterRoot, "extensions", "must-not-load.ts"), "throw new Error('retired adapter loaded');\n"),
      writeFile(join(agentDir, "settings.json"), JSON.stringify({
        packages: ["legacy-adapter"],
        extensions: ["legacy-adapter/extensions/must-not-load.ts"]
      }))
    ]);
    const settingsManager = SettingsManager.create(workspace, agentDir, { projectTrusted: true });
    const sessionView = createDesktopPackageSettingsView(
      settingsManager,
      environment,
      undefined,
      undefined,
      { agentDir, cwd: workspace }
    );
    const services = await createAgentSessionServices({ cwd: workspace, agentDir, settingsManager: sessionView });

    expect(sessionView.getGlobalSettings()).toMatchObject({ packages: [], extensions: [] });
    expect(services.resourceLoader.getExtensions().extensions).toEqual([]);
    expect(services.resourceLoader.getExtensions().errors).toEqual([]);
    expect(settingsManager.getGlobalSettings()).toMatchObject({
      packages: ["legacy-adapter"],
      extensions: ["legacy-adapter/extensions/must-not-load.ts"]
    });
  });
});

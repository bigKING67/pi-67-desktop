import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("Windows installed profile authority wiring", () => {
  it("injects environment drift after Main launch and before the fresh profile selects a Workspace", async () => {
    const lifecycle = await readFile(
      join(repositoryRoot, "eng/packaging/windows-real-user-lifecycle.mjs"),
      "utf8"
    );
    const launch = lifecycle.indexOf("application = await launchPackagedApplication({");
    const environmentDrift = lifecycle.indexOf("process.env.PI_CODING_AGENT_DIR = driftAgentDir");
    const firstWindow = lifecycle.indexOf("const window = await application.firstWindow()");
    const workspaceSelection = lifecycle.indexOf("await installWorkspaceDialogResult(application, workspace)");

    expect(launch).toBeGreaterThan(-1);
    expect(environmentDrift).toBeGreaterThan(launch);
    expect(firstWindow).toBeGreaterThan(environmentDrift);
    expect(workspaceSelection).toBeGreaterThan(firstWindow);
  });

  it("uses a fresh localized user-data profile for the configuration lifecycle", async () => {
    const verifier = await readFile(
      join(repositoryRoot, "eng/packaging/verify-windows-installer-lifecycle.mjs"),
      "utf8"
    );

    expect(verifier).toContain("mkdir(lifecycleUserDataDirectory, { recursive: true })");
    expect(verifier).toContain("agentDir: lifecycleAgentDir");
    expect(verifier).toContain("environmentDriftAgentDir: lifecycleEnvironmentDriftAgentDir");
    expect(verifier).toContain("userDataDirectory: lifecycleUserDataDirectory");
    expect(verifier).toContain("assertPreservedUserData(lifecycleUserDataDirectory)");
    expect(verifier).toContain("extensionPath: lifecycleExtensionPath");
  });
});

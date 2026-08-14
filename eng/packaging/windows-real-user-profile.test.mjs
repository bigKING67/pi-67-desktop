import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertWindowsExistingProfilePreserved,
  inspectCleanWindowsRealUserProfile,
  prepareFreshWindowsRealUserProfile,
  prepareWindowsRealUserProfile,
  resolveWindowsRealUserProfilePaths,
  snapshotWindowsExistingProfile,
  WINDOWS_REAL_USER_CONFIGURED_PROVIDER
} from "./windows-real-user-profile.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Windows installed real-user Pi profile", () => {
  it("prepares a configured profile in a localized path and keeps the drift target empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-windows-profile-"));
    try {
      const profile = resolveWindowsRealUserProfilePaths(root);
      await prepareWindowsRealUserProfile(profile);

      expect(profile.agentDir).toContain("Pi 配置 含空格");
      expect(profile.environmentDriftAgentDir).toContain("错误 Pi 配置 空目录");
      expect(profile.lifecycleAgentDir).toContain("生命周期 Pi 配置 含空格");
      expect(profile.lifecycleAgentDir).not.toBe(profile.agentDir);
      expect(profile.lifecycleEnvironmentDriftAgentDir).toContain("生命周期错误 Pi 配置 空目录");
      expect(profile.lifecycleUserDataDirectory).toContain("生命周期用户数据 含空格");
      expect(profile.cleanLifecycleAgentDir).toContain("全新 Pi 配置 含空格");
      expect(await readdir(profile.environmentDriftAgentDir)).toEqual([]);
      expect(await readdir(profile.lifecycleEnvironmentDriftAgentDir)).toEqual([]);
      expect(await readdir(profile.cleanLifecycleEnvironmentDriftAgentDir)).toEqual([]);
      await expect(access(profile.cleanLifecycleAgentDir)).rejects.toMatchObject({ code: "ENOENT" });
      expect(JSON.parse(await readFile(join(profile.agentDir, "auth.json"), "utf8")))
        .toMatchObject({ openai: { type: "api_key" } });
      expect(JSON.parse(await readFile(join(profile.lifecycleAgentDir, "auth.json"), "utf8")))
        .toMatchObject({ openai: { type: "api_key" } });
      expect(JSON.parse(await readFile(join(profile.agentDir, "settings.json"), "utf8")))
        .toEqual({ defaultProvider: "openai", defaultModel: "gpt-5" });
      expect(JSON.parse(await readFile(join(profile.lifecycleAgentDir, "settings.json"), "utf8")))
        .toEqual({ defaultProvider: "openai", defaultModel: "gpt-5" });
      expect(JSON.parse(await readFile(join(profile.lifecycleAgentDir, "models.json"), "utf8")))
        .toEqual({ providers: {} });
      expect(JSON.parse(await readFile(join(profile.lifecycleAgentDir, "mcp.json"), "utf8")))
        .toMatchObject({
          mcpServers: {
            tmwd_browser: { command: "user-browser67" },
            "js-reverse": { command: "user-js-reverse" }
          }
        });
      expect(await readFile(join(profile.lifecycleAgentDir, "AGENTS.md"), "utf8"))
        .toContain("Existing Pi TUI user instructions");
      expect(await readFile(join(profile.lifecycleAgentDir, "sessions", "legacy", "session.jsonl"), "utf8"))
        .toContain("existing-pi-tui-session");
      expect(JSON.parse(await readFile(
        join(profile.lifecycleAgentDir, "desktop-capabilities", "state.json"),
        "utf8"
      ))).not.toHaveProperty("profileOwnership");
      expect(WINDOWS_REAL_USER_CONFIGURED_PROVIDER).toBe("openai");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("provisions a clean Profile before adding the controlled Provider fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-windows-clean-profile-"));
    const agentDir = join(root, "agent");
    try {
      await mkdir(join(agentDir, "desktop-capabilities"), { recursive: true });
      await writeFile(join(agentDir, "desktop-capabilities", "state.json"), JSON.stringify({
        schema: "pi67.desktop-capability-state.v1",
        packages: [{ id: "pi67-core" }],
        profileOwnership: "desktop",
        rules: "installed"
      }));
      await writeFile(join(agentDir, "mcp.json"), JSON.stringify({
        pi67ManagedMcp: {
          servers: { tmwd_browser: {}, "js-reverse": {} }
        }
      }));

      await prepareFreshWindowsRealUserProfile({
        agentDir,
        provisioningTimeoutMs: 1_000,
        writeControlledExtension: (path) => writeFile(path, "export default function fixture() {}\n")
      });

      await expect(inspectCleanWindowsRealUserProfile(agentDir)).resolves.toEqual({
        browser67ManagedServers: ["js-reverse", "tmwd_browser"],
        capabilityPackageCount: 1,
        profileOwnership: "desktop",
        rules: "installed"
      });
      expect(JSON.parse(await readFile(join(agentDir, "auth.json"), "utf8")))
        .toMatchObject({ openai: { type: "api_key" } });
      expect(await readFile(join(agentDir, "extensions", "installer-lifecycle-fixture.ts"), "utf8"))
        .toContain("fixture");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the installed-runtime budget when clean provisioning exceeds the former 15-second limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-windows-slow-clean-profile-"));
    const agentDir = join(root, "agent");
    let simulatedNow = 0;
    let provisioned = false;
    vi.spyOn(Date, "now").mockImplementation(() => simulatedNow);
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay = 0) => {
      simulatedNow += Number(delay);
      const provision = simulatedNow > 15_000 && !provisioned
        ? writeCleanProvisioningState(agentDir).then(() => {
          provisioned = true;
        })
        : Promise.resolve();
      void provision.then(callback);
      return 0;
    });
    try {
      await prepareFreshWindowsRealUserProfile({
        agentDir,
        provisioningTimeoutMs: 75_000,
        writeControlledExtension: (path) => writeFile(path, "export default function fixture() {}\n")
      });

      expect(simulatedNow).toBeGreaterThan(15_000);
      await expect(inspectCleanWindowsRealUserProfile(agentDir)).resolves.toMatchObject({
        profileOwnership: "desktop"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports bounded provisioning state without paths or Profile contents", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-windows-clean-profile-diagnostic-"));
    const agentDir = join(root, "private-agent-root");
    try {
      await mkdir(join(agentDir, "desktop-capabilities"), { recursive: true });
      await writeFile(join(agentDir, "desktop-capabilities", "state.json"), "{invalid", "utf8");
      await writeFile(join(agentDir, "mcp.json"), "{}\n", "utf8");

      const error = await prepareFreshWindowsRealUserProfile({
        agentDir,
        provisioningTimeoutMs: 1,
        writeControlledExtension: () => Promise.resolve()
      }).then(() => undefined, (failure) => failure);

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("within 1ms");
      expect(error.message).toContain('"profileRootExists":true');
      expect(error.message).toContain('"state":{"status":"invalid"');
      expect(error.message).toContain('"mcp":{"status":"valid"');
      expect(error.message).toContain('"hasJsReverse":false');
      expect(error.message).toContain('"hasTmwdBrowser":false');
      expect(error.message).not.toContain(root);
      expect(error.message).not.toContain("private-agent-root");
      expect(error.message).not.toContain("{invalid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("hashes pre-existing Pi TUI files while allowing new Desktop-owned files", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-windows-existing-profile-"));
    try {
      const profile = resolveWindowsRealUserProfilePaths(root);
      await prepareWindowsRealUserProfile(profile);
      const before = await snapshotWindowsExistingProfile(profile.lifecycleAgentDir);
      await mkdir(join(profile.lifecycleAgentDir, "desktop-capabilities"), { recursive: true });
      await writeFile(join(profile.lifecycleAgentDir, "desktop-capabilities", "state.json"), "{}\n");
      await expect(assertWindowsExistingProfilePreserved(profile.lifecycleAgentDir, before))
        .resolves.toEqual({ preservedFileCount: Object.keys(before).length });

      await writeFile(join(profile.lifecycleAgentDir, "AGENTS.md"), "changed\n");
      await expect(assertWindowsExistingProfilePreserved(profile.lifecycleAgentDir, before))
        .rejects.toThrow("changed user files");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writeCleanProvisioningState(agentDir) {
  await mkdir(join(agentDir, "desktop-capabilities"), { recursive: true });
  await Promise.all([
    writeFile(join(agentDir, "desktop-capabilities", "state.json"), JSON.stringify({
      schema: "pi67.desktop-capability-state.v1",
      packages: [{ id: "pi67-core" }],
      profileOwnership: "desktop",
      rules: "installed"
    })),
    writeFile(join(agentDir, "mcp.json"), JSON.stringify({
      pi67ManagedMcp: {
        servers: { tmwd_browser: {}, "js-reverse": {} }
      }
    }))
  ]);
}

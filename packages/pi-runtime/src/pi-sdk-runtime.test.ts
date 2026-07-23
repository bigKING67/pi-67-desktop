import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";

const temporaryDirectories: string[] = [];
// Two cold Pi SDK initializations can exceed 15 seconds under Windows Defender on hosted runners.
const sdkSmokeTimeout = process.platform === "win32" ? 45_000 : 15_000;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PiSdkRuntime", () => {
  it("creates an isolated real Pi SDK session without a system pi process", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-runtime-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await Promise.all([mkdir(cwd), mkdir(agentDir)]);
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = root;
    process.env.USERPROFILE = root;

    const runtime = new PiSdkRuntime();
    const restoredRuntime = new PiSdkRuntime();
    try {
      const snapshot = await runtime.initialize({
        cwd,
        agentDir,
        trust: "unknown",
        approvalMode: "guided"
      });

      expect(snapshot.cwd).toBe(cwd);
      expect(snapshot.sessionId).toBeTruthy();
      expect(snapshot.streaming).toBe(false);
      expect(snapshot.models.length).toBeGreaterThan(0);
      expect(snapshot.messages).toEqual([]);
      expect(snapshot.resources.filter((resource) => resource.kind === "skill")).toEqual([]);
      expect(snapshot.resources).toEqual([
        expect.objectContaining({
          id: "<inline:pi67-desktop-safety>",
          kind: "extension",
          status: "ready"
        })
      ]);

      const renamed = await runtime.setSessionName("Isolated SDK smoke");
      expect(renamed.sessionName).toBe("Isolated SDK smoke");
      const provider = snapshot.models.find((model) => !model.configured)?.provider;
      if (!provider) throw new Error("Pi SDK smoke requires at least one unconfigured provider.");
      const authPath = join(agentDir, "auth.json");
      const authBefore = await readFile(authPath, "utf8");
      const runtimeKey = "pi67-test-runtime-secret";
      const configured = await runtime.setRuntimeApiKey(provider, runtimeKey);
      expect(configured.models.some((model) => model.provider === provider && model.configured)).toBe(true);
      const diagnostics = await runtime.collectDiagnostics();
      expect(diagnostics).toMatchObject({
        application: "Pi-67 Desktop",
        piSdkVersion: "0.81.1",
        sessionConfigured: true
      });
      expect(JSON.stringify(diagnostics)).not.toMatch(/api.?key|token|prompt/iu);
      expect(JSON.stringify(diagnostics)).not.toContain(runtimeKey);
      expect(await readFile(authPath, "utf8")).toBe(authBefore);
      expect(authBefore).not.toContain(runtimeKey);

      const restored = await restoredRuntime.initialize({ cwd, agentDir, trust: "unknown", approvalMode: "guided" });
      expect(restored.models.some((model) => model.provider === provider && model.configured)).toBe(false);
    } finally {
      await runtime.dispose();
      await restoredRuntime.dispose();
      restoreEnvironment("HOME", originalHome);
      restoreEnvironment("USERPROFILE", originalUserProfile);
    }
  }, sdkSmokeTimeout);
});

function restoreEnvironment(name: "HOME" | "USERPROFILE", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

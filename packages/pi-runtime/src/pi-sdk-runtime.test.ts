import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";

const temporaryDirectories: string[] = [];
const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

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
      const sessionPath = renamed.sessionPath;
      if (!sessionPath) throw new Error("Pi SDK smoke requires a session path.");
      expect(sessionPath.startsWith(`${join(agentDir, "sessions")}${sep}`)).toBe(true);
      const fixture = SessionManager.create(cwd, dirname(sessionPath));
      fixture.appendSessionInfo("Restored SDK smoke");
      fixture.appendMessage({ role: "user", content: "Restore this isolated Pi session.", timestamp: Date.now() });
      fixture.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Isolated Pi session restored." }],
        api: "openai-responses",
        provider: "pi67-test",
        model: "fixture",
        usage: zeroUsage,
        stopReason: "stop",
        timestamp: Date.now() + 1
      });
      const fixturePath = fixture.getSessionFile();
      if (!fixturePath) throw new Error("Pi SDK smoke fixture was not persisted.");
      expect(await runtime.listSessions()).toEqual([
        expect.objectContaining({ path: fixturePath, name: "Restored SDK smoke" })
      ]);
      expect((await runtime.listSessions(true)).some((session) => session.path === fixturePath)).toBe(true);
      const provider = snapshot.models.find((model) => !model.configured)?.provider;
      if (!provider) throw new Error("Pi SDK smoke requires at least one unconfigured provider.");
      const authPath = join(agentDir, "auth.json");
      const authBefore = await readFile(authPath, "utf8");
      const runtimeKey = "pi67-test-runtime-secret";
      const configured = await expectNoFetch(() => runtime.setRuntimeApiKey(provider, runtimeKey));
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

      const restored = await restoredRuntime.initialize({
        cwd,
        agentDir,
        sessionPath: fixturePath,
        trust: "unknown",
        approvalMode: "guided"
      });
      expect(restored.sessionId).toBe(fixture.getSessionId());
      expect(restored.sessionName).toBe("Restored SDK smoke");
      expect(restored.messages).toHaveLength(2);
      expect(restored.models.some((model) => model.provider === provider && model.configured)).toBe(false);
      await expect(stat(join(root, ".pi", "agent", "sessions"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await runtime.dispose();
      await restoredRuntime.dispose();
      restoreEnvironment("HOME", originalHome);
      restoreEnvironment("USERPROFILE", originalUserProfile);
    }
  }, 15_000);
});

async function expectNoFetch<T>(operation: () => Promise<T>): Promise<T> {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network access."));
  try {
    const result = await operation();
    expect(fetchSpy).not.toHaveBeenCalled();
    return result;
  } finally {
    fetchSpy.mockRestore();
  }
}

function restoreEnvironment(name: "HOME" | "USERPROFILE", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

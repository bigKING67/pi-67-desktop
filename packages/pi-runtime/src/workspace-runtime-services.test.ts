import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentSession,
  DefaultPackageManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";
import type { RuntimeSessionCatalogOwner } from "./runtime-session-catalog.js";
import { createRuntimeCredentialOverrideStore } from "./runtime-credential-overrides.js";
import { createPiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";

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
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("Pi Workspace runtime services", () => {
  it("shares Workspace settings, catalog, and memory-only credentials across Task runtimes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-workspace-runtime-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await Promise.all([mkdir(cwd), mkdir(agentDir)]);

    const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
    const workspaceServices = createPiWorkspaceRuntimeServices({
      cwd,
      agentDir,
      projectTrusted: true,
      settingsManager
    });
    expect(workspaceServices.cwd).toBe(resolve(cwd));
    expect(workspaceServices.agentDir).toBe(resolve(agentDir));
    const runtimeCredentialOverrides = createRuntimeCredentialOverrideStore();
    const runtimeA = new PiSdkRuntime({ workspaceServices, runtimeCredentialOverrides });
    const runtimeB = new PiSdkRuntime({ workspaceServices, runtimeCredentialOverrides });
    const catalogEventsA: string[] = [];
    const catalogEventsB: string[] = [];
    runtimeA.subscribe((event) => {
      if (event.type === "session.catalog.changed") catalogEventsA.push(event.payload.reason);
    });
    runtimeB.subscribe((event) => {
      if (event.type === "session.catalog.changed") catalogEventsB.push(event.payload.reason);
    });

    try {
      const [snapshotA, snapshotB] = await Promise.all([
        runtimeA.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" }),
        runtimeB.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" })
      ]);
      const provider = snapshotA.models.find((model) => (
        !model.configured && snapshotB.models.some((candidate) => candidate.provider === model.provider)
      ))?.provider;
      if (!provider) throw new Error("Workspace runtime fixture requires an unconfigured provider.");

      const internalsA = runtimeInternals(runtimeA);
      const internalsB = runtimeInternals(runtimeB);
      expect(internalsA.services.settingsManager).toBe(settingsManager);
      expect(internalsB.services.settingsManager).toBe(settingsManager);
      expect(internalsA.services.resourceLoader).not.toBe(internalsB.services.resourceLoader);
      expect(workspaceServices.packageManager).toBeInstanceOf(DefaultPackageManager);

      const runtimeKey = "pi67-shared-runtime-secret";
      const configured = await runtimeA.setRuntimeApiKey(provider, runtimeKey);
      expect(configured.modelCatalog.providers).toContainEqual(expect.objectContaining({
        id: provider,
        configured: true,
        credentialSource: "runtime"
      }));
      expect(runtimeB.getSnapshot().providers).toContainEqual(expect.objectContaining({
        id: provider,
        configured: true,
        credentialSource: "runtime"
      }));
      expect(runtimeCredentialOverrides.snapshot()).toEqual({ revision: 1, providers: [provider] });

      internalsA.requireSession().setSessionName("Shared catalog update");
      internalsA.requireSession().sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Persist the shared catalog fixture." }],
        api: "openai-responses",
        provider: "pi67-test",
        model: "fixture",
        usage: zeroUsage,
        stopReason: "stop",
        timestamp: Date.now()
      });
      await runtimeCatalog(runtimeA).upsertCurrent("session-updated");
      expect(catalogEventsA).toContain("session-updated");
      expect(catalogEventsB).toContain("session-updated");

      for (const projection of [
        configured,
        runtimeA.getSnapshot(),
        runtimeB.getSnapshot(),
        await runtimeA.collectDiagnostics(),
        await runtimeB.collectDiagnostics(),
        runtimeCredentialOverrides.snapshot()
      ]) {
        expect(JSON.stringify(projection)).not.toContain(runtimeKey);
      }

      await runtimeA.dispose();
      const afterPeerDispose = await runtimeB.createSession("session-creation-peer-dispose");
      expect(afterPeerDispose.providers).toContainEqual(expect.objectContaining({
        id: provider,
        configured: true,
        credentialSource: "runtime"
      }));
      expect(runtimeCredentialOverrides.snapshot().providers).toEqual([provider]);
    } finally {
      await Promise.all([runtimeA.dispose(), runtimeB.dispose()]);
      await workspaceServices.dispose();
      await runtimeCredentialOverrides.clear();
    }
  }, 20_000);

  it("rejects a Runtime initialized outside its injected Workspace boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-workspace-boundary-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const otherCwd = join(root, "other-workspace");
    const agentDir = join(root, "agent");
    await Promise.all([mkdir(cwd), mkdir(otherCwd), mkdir(agentDir)]);
    const workspaceServices = createPiWorkspaceRuntimeServices({ cwd, agentDir });
    const runtime = new PiSdkRuntime({ workspaceServices });

    try {
      await expect(runtime.initialize({
        cwd: otherCwd,
        agentDir,
        trust: "unknown",
        approvalMode: "guided"
      })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    } finally {
      await runtime.dispose();
      await workspaceServices.dispose();
    }
  });

  it("accepts Windows Workspace path casing changes without relaxing Agent directory identity", async () => {
    const windowsPlatform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const workspaceServices = createPiWorkspaceRuntimeServices({
      cwd: String.raw`C:\Users\Runner\Workspace`,
      agentDir: String.raw`C:\Pi Agent`,
      settingsManager: SettingsManager.inMemory()
    });
    try {
      expect(() => workspaceServices.assertCompatible(
        String.raw`c:\users\runner\workspace`,
        String.raw`C:\Pi Agent`
      )).not.toThrow();
      expect(() => workspaceServices.assertCompatible(
        String.raw`c:\users\runner\workspace`,
        String.raw`c:\pi agent`
      )).toThrow(expect.objectContaining({ code: "INVALID_PAYLOAD" }));
    } finally {
      await workspaceServices.dispose();
      windowsPlatform.mockRestore();
    }
  });

  it("leaves an injected Agent Host Session Catalog owner alive when Workspace services dispose", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-shared-catalog-owner-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await Promise.all([mkdir(cwd), mkdir(agentDir)]);
    const dispose = vi.fn(async () => undefined);
    const sessionCatalogOwner = {
      createBinding: vi.fn(),
      status: vi.fn(),
      dispose
    } as unknown as RuntimeSessionCatalogOwner;
    const workspaceServices = createPiWorkspaceRuntimeServices({
      cwd,
      agentDir,
      settingsManager: SettingsManager.inMemory(),
      sessionCatalogOwner
    });

    await workspaceServices.dispose();

    expect(workspaceServices.sessionCatalog).toBe(sessionCatalogOwner);
    expect(dispose).not.toHaveBeenCalled();
  });
});

function runtimeCatalog(runtime: PiSdkRuntime) {
  return (runtime as unknown as {
    sessionCatalog: {
      upsertCurrent(reason: "session-updated"): Promise<void>;
    };
  }).sessionCatalog;
}

function runtimeInternals(runtime: PiSdkRuntime) {
  return (runtime as unknown as {
    sessionBindings: {
      services: {
        settingsManager: SettingsManager;
        resourceLoader: object;
      };
      requireSession(): AgentSession;
    };
  }).sessionBindings;
}

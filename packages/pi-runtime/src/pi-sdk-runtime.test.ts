import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { SessionTreeProjection } from "@pi67/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";
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
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("PiSdkRuntime", () => {
  it("uses the Pi session runtime lifecycle for new sessions and reloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-lifecycle-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const extensionsDirectory = join(agentDir, "extensions");
    const lifecyclePath = join(root, "extension-lifecycle.txt");
    await Promise.all([mkdir(cwd), mkdir(extensionsDirectory, { recursive: true })]);
    await writeFile(join(extensionsDirectory, "lifecycle.ts"), `
      import { appendFileSync } from "node:fs";
      export default function lifecycle(pi) {
        pi.on("session_start", (event) => appendFileSync(${JSON.stringify(lifecyclePath)}, "start:" + event.reason + "\\n"));
        pi.on("session_shutdown", (event) => appendFileSync(${JSON.stringify(lifecyclePath)}, "shutdown:" + event.reason + "\\n"));
      }
    `, "utf8");

    const runtime = new PiSdkRuntime();
    const extensionErrors: string[] = [];
    runtime.subscribe((event) => {
      if (event.type === "extension.compatibilityChanged") extensionErrors.push(event.payload.detail);
    });
    try {
      const initial = await runtime.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" });
      const created = await runtime.createSession("session-creation-lifecycle");
      expect(created.sessionId).not.toBe(initial.sessionId);
      expect(created.cwd).toBe(cwd);
      const resources = await runtime.reloadResources();
      expect(Object.keys(resources).sort()).toEqual([
        "controls",
        "modelCatalog",
        "resourceCatalog",
        "resources",
        "sessionId"
      ]);
      expect(resources.resourceCatalog).toEqual({
        totalItems: resources.resources.length,
        projectedItems: resources.resources.length,
        omittedItems: 0,
        truncatedFields: 0,
        truncated: false
      });
      expect(resources).not.toHaveProperty("messages");
      expect(resources).not.toHaveProperty("tree");
      expect(resources).not.toHaveProperty("steeringQueue");
      await runtime.dispose();

      expect((await readFile(lifecyclePath, "utf8")).trim().split("\n")).toEqual([
        "start:startup",
        "shutdown:new",
        "start:new",
        "shutdown:reload",
        "start:reload",
        "shutdown:quit"
      ]);
      expect(extensionErrors).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  }, 15_000);

  it("reapplies managed Desktop Package overrides before reloading Pi resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-package-reload-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const managedRoot = join(agentDir, "desktop-capabilities");
    const bundledPackage = join(managedRoot, "packages", "pi67-core");
    const overlayPackage = join(managedRoot, "skill-packs", "ai-berkshire-investment-suite", "package");
    const toolchainRoot = join(root, "toolchain");
    await Promise.all([
      mkdir(cwd),
      mkdir(bundledPackage, { recursive: true }),
      mkdir(overlayPackage, { recursive: true }),
      mkdir(join(overlayPackage, "skills", "managed-reload"), { recursive: true })
    ]);
    for (const [path, name] of [
      [bundledPackage, "@pi67/core"],
      [overlayPackage, "@pi67/managed-ai-berkshire-investment-suite"]
    ] as const) {
      await writeFile(join(path, "package.json"), JSON.stringify({
        name,
        version: "1.0.0",
        private: true,
        pi: { skills: path === overlayPackage ? ["skills/managed-reload"] : [] }
      }), "utf8");
    }
    await writeFile(join(overlayPackage, "skills", "managed-reload", "SKILL.md"), [
      "---",
      "name: managed-reload",
      "description: Verifies that a managed Desktop Package survives Pi resource reloads.",
      "---",
      "",
      "# Managed reload",
      ""
    ].join("\n"), "utf8");
    const keys = [
      "PI67_DESKTOP",
      "PI67_PACKAGED",
      "PI67_TOOLCHAIN_ROOT",
      "PI67_NODE_EXECUTABLE",
      "PI67_NPM_CLI",
      "PI67_GIT_EXECUTABLE",
      "PI67_GIT_EXEC_PATH",
      "PI67_MANAGED_CAPABILITIES_ROOT",
      "PI67_CAPABILITY_PACKAGE_PATHS"
    ] as const;
    const previous = new Map(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      PI67_DESKTOP: "1",
      PI67_PACKAGED: "0",
      PI67_TOOLCHAIN_ROOT: toolchainRoot,
      PI67_NODE_EXECUTABLE: join(toolchainRoot, "node", "bin", "node"),
      PI67_NPM_CLI: join(toolchainRoot, "npm", "bin", "npm-cli.js"),
      PI67_GIT_EXECUTABLE: join(toolchainRoot, "git", "bin", "git"),
      PI67_GIT_EXEC_PATH: join(toolchainRoot, "git", "libexec", "git-core"),
      PI67_MANAGED_CAPABILITIES_ROOT: managedRoot,
      PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([bundledPackage])
    });
    const settingsManager = SettingsManager.inMemory();
    const reloadSettings = vi.spyOn(settingsManager, "reload");
    const applyOverrides = vi.spyOn(settingsManager, "applyOverrides");
    const services = createPiWorkspaceRuntimeServices({ cwd, agentDir, settingsManager });
    const runtime = new PiSdkRuntime({ workspaceServices: services });
    try {
      await runtime.initialize({ cwd, agentDir, trust: "trusted", approvalMode: "guided" });
      reloadSettings.mockClear();
      applyOverrides.mockClear();
      process.env.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify([overlayPackage, bundledPackage]);

      const resources = await runtime.reloadResources();

      expect(reloadSettings).toHaveBeenCalled();
      expect(applyOverrides).toHaveBeenCalledWith(expect.objectContaining({
        packages: [overlayPackage, bundledPackage]
      }));
      expect(resources.resources).toContainEqual(expect.objectContaining({
        kind: "skill",
        id: "managed-reload",
        status: "ready"
      }));
    } finally {
      await runtime.dispose();
      await services.dispose();
      for (const key of keys) restoreEnvironment(key, previous.get(key));
    }
  }, 15_000);

  it("commits workspace cwd and trust before target extensions start", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-workspace-policy-"));
    temporaryDirectories.push(root);
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    const agentDir = join(root, "agent");
    const extensionsDirectory = join(agentDir, "extensions");
    const lifecyclePath = join(root, "workspace-lifecycle.jsonl");
    await Promise.all([
      mkdir(workspaceA),
      mkdir(workspaceB),
      mkdir(extensionsDirectory, { recursive: true })
    ]);
    await writeFile(join(extensionsDirectory, "workspace-lifecycle.ts"), `
      import { appendFileSync } from "node:fs";
      export default function workspaceLifecycle(pi) {
        const record = (phase, event, ctx) => appendFileSync(
          ${JSON.stringify(lifecyclePath)},
          JSON.stringify({ phase, reason: event.reason, cwd: ctx.sessionManager.getCwd(), trusted: ctx.isProjectTrusted() }) + "\\n"
        );
        pi.on("session_start", (event, ctx) => record("start", event, ctx));
        pi.on("session_shutdown", (event, ctx) => record("shutdown", event, ctx));
      }
    `, "utf8");

    const runtime = new PiSdkRuntime();
    try {
      await runtime.initialize({
        cwd: workspaceA,
        agentDir,
        trust: "trusted",
        approvalMode: "balanced"
      });
      const target = await runtime.initialize({
        cwd: workspaceB,
        agentDir,
        trust: "unknown",
        approvalMode: "guided"
      });

      expect(target.cwd).toBe(workspaceB);
      const records = (await readFile(lifecyclePath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records).toEqual([
        { phase: "start", reason: "startup", cwd: workspaceA, trusted: true },
        { phase: "shutdown", reason: "quit", cwd: workspaceA, trusted: true },
        { phase: "start", reason: "startup", cwd: workspaceB, trusted: false }
      ]);
    } finally {
      await runtime.dispose();
    }
  }, 15_000);

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
    const catalogs: Array<ReturnType<PiSdkRuntime["getExtensionCatalog"]>> = [];
    const externalChanges: Array<{ reason: string; recoverable: boolean }> = [];
    runtime.subscribe((event) => {
      if (event.type === "extension.catalog.changed") catalogs.push(event.payload);
    });
    restoredRuntime.subscribe((event) => {
      if (event.type === "session.externalChangeDetected") externalChanges.push(event.payload);
    });
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
      expect(snapshot.resources).toEqual([]);
      expect(runtime.getExtensionCatalog()).toEqual({ items: [], total: 0, truncated: false });
      expect(catalogs).toEqual([{ items: [], total: 0, truncated: false }]);

      await runtime.setSessionName("Isolated SDK smoke");
      const renamed = runtime.getSnapshot();
      expect(renamed.sessionName).toBe("Isolated SDK smoke");
      const sessionPath = renamed.sessionPath;
      if (!sessionPath) throw new Error("Pi SDK smoke requires a session path.");
      expect(sessionPath.startsWith(`${join(await realpath(agentDir), "sessions")}${sep}`)).toBe(true);
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
      const workspaceCatalog = await queryReadyCatalog(runtime, { scope: "workspace" });
      expect(workspaceCatalog.items).toHaveLength(2);
      expect(workspaceCatalog.items.find((item) => item.id === renamed.sessionId)).toMatchObject({
        name: "Isolated SDK smoke",
        messageCount: 0
      });
      const restoredCatalogItem = workspaceCatalog.items.find((item) => item.id === fixture.getSessionId());
      expect(restoredCatalogItem).toMatchObject({ name: "Restored SDK smoke", messageCount: 2 });
      expect(await realpath(restoredCatalogItem?.path ?? "")).toBe(await realpath(fixturePath));
      const allCatalog = await queryReadyCatalog(runtime, { scope: "all" });
      expect(allCatalog.items.some((session) => session.id === fixture.getSessionId())).toBe(true);

      const externalSessionDir = join(root, "external-sessions");
      await mkdir(externalSessionDir);
      const externalFixture = SessionManager.create(cwd, externalSessionDir);
      externalFixture.appendSessionInfo("Imported SDK smoke");
      externalFixture.appendMessage({ role: "user", content: "Import this Pi session.", timestamp: Date.now() + 2 });
      externalFixture.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Imported Pi session restored." }],
        api: "openai-responses",
        provider: "pi67-test",
        model: "fixture",
        usage: zeroUsage,
        stopReason: "stop",
        timestamp: Date.now() + 3
      });
      const externalPath = externalFixture.getSessionFile();
      if (!externalPath) throw new Error("Pi SDK import fixture was not persisted.");
      const externalContent = await readFile(externalPath, "utf8");
      await expect(runtime.openSession(externalPath, cwd)).rejects.toThrow(/managed Pi sessions/u);
      expect(await readFile(externalPath, "utf8")).toBe(externalContent);

      const firstImport = await runtime.importSession(externalPath);
      const firstImportPath = firstImport.sessionPath;
      if (!firstImportPath) throw new Error("Imported Pi SDK session must be persisted.");
      expect(firstImportPath).not.toBe(externalPath);
      expect(await realpath(dirname(firstImportPath))).toBe(await realpath(dirname(sessionPath)));
      expect(firstImport.sessionId).toBe(externalFixture.getSessionId());
      expect(firstImport.sessionName).toBe("Imported SDK smoke");
      expect(firstImport.messages).toHaveLength(2);
      expect(runtime.getSessionTree()).toEqual(firstImport.tree);
      expect(hasActiveTreeNode(runtime.getSessionTree())).toBe(true);
      expect(await readFile(externalPath, "utf8")).toBe(externalContent);
      await runtime.setSessionName("Renamed imported SDK smoke");
      const firstImportContent = await readFile(firstImportPath, "utf8");
      expect((await runtime.querySessionCatalog({ scope: "workspace" })).items
        .find((session) => session.path === firstImportPath)).toMatchObject({
          name: "Renamed imported SDK smoke",
          messageCount: 2
        });

      const secondImport = await runtime.importSession(externalPath);
      const secondImportPath = secondImport.sessionPath;
      if (!secondImportPath) throw new Error("Repeated Pi SDK import must be persisted.");
      expect(secondImportPath).not.toBe(firstImportPath);
      expect(await realpath(dirname(secondImportPath))).toBe(await realpath(dirname(sessionPath)));
      expect(secondImportPath).toMatch(/-imported-1\.jsonl$/u);
      expect(await readFile(firstImportPath, "utf8")).toBe(firstImportContent);
      expect(await readFile(externalPath, "utf8")).toBe(externalContent);

      const managedFilesBeforeInvalidImport = await readdir(dirname(sessionPath));
      const invalidPath = join(root, "invalid-session.jsonl");
      await writeFile(invalidPath, "not a Pi JSONL session\n", "utf8");
      await expect(runtime.importSession(invalidPath)).rejects.toThrow();
      expect(await readdir(dirname(sessionPath))).toEqual(managedFilesBeforeInvalidImport);

      const managedImport = await runtime.importSession(fixturePath);
      expect(await realpath(managedImport.sessionPath ?? "")).toBe(await realpath(fixturePath));
      expect(managedImport.cwd).toBe(cwd);
      const provider = snapshot.models.find((model) => !model.configured)?.provider;
      if (!provider) throw new Error("Pi SDK smoke requires at least one unconfigured provider.");
      const authPath = join(agentDir, "auth.json");
      const authBefore = await readFile(authPath, "utf8");
      const runtimeKey = "pi67-test-runtime-secret";
      const configured = await expectNoFetch(() => runtime.setRuntimeApiKey(provider, runtimeKey));
      expect(Object.keys(configured).sort()).toEqual(["controls", "modelCatalog", "sessionId"]);
      expect(configured).not.toHaveProperty("messages");
      expect(configured).not.toHaveProperty("tree");
      expect(configured).not.toHaveProperty("steeringQueue");
      expect(configured.modelCatalog.models.some((model) => model.provider === provider && model.configured)).toBe(true);
      expect(configured.modelCatalog.providers).toContainEqual(expect.objectContaining({
        id: provider,
        configured: true,
        credentialSource: "runtime"
      }));
      expect(JSON.stringify(configured.modelCatalog.providers)).not.toContain(runtimeKey);
      const configuredAfterNewSession = await runtime.createSession("session-creation-configuration");
      expect(configuredAfterNewSession.providers).toContainEqual(expect.objectContaining({
        id: provider,
        configured: true,
        credentialSource: "runtime"
      }));
      expect(JSON.stringify(configuredAfterNewSession)).not.toContain(runtimeKey);
      const diagnostics = await runtime.collectDiagnostics();
      expect(diagnostics).toMatchObject({
        application: "π",
        piSdkVersion: "0.84.2",
        sessionConfigured: true,
        toolExecutionReceiptFailureCount: 0
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
      await restoredRuntime.setSessionName("Desktop rename one");
      await restoredRuntime.setSessionName("Desktop rename two");
      const restoredRenamed = restoredRuntime.getSnapshot();
      expect(restoredRenamed.sessionName).toBe("Desktop rename two");
      expect(externalChanges).toEqual([]);
      await appendFile(fixturePath, `${JSON.stringify({
        type: "session_info",
        id: "external-change",
        parentId: fixture.getLeafId(),
        timestamp: new Date().toISOString(),
        name: "Changed outside Desktop"
      })}\n`);
      await vi.waitFor(() => {
        expect(externalChanges).toEqual([{ reason: "appended", recoverable: true }]);
      }, { timeout: 1_000 });
      await expect(restoredRuntime.submitPrompt("must not execute"))
        .rejects.toMatchObject({ code: "SESSION_CHANGED_EXTERNALLY", recoverable: true });
      expect(JSON.stringify(externalChanges)).not.toContain(fixturePath);
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

async function queryReadyCatalog(
  runtime: PiSdkRuntime,
  query: Parameters<PiSdkRuntime["querySessionCatalog"]>[0]
) {
  await runtime.querySessionCatalog({ ...query, refresh: true });
  await vi.waitFor(() => expect(runtime.getSessionCatalogStatus().rebuilding).toBe(false), { timeout: 5_000 });
  return runtime.querySessionCatalog(query);
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function hasActiveTreeNode(tree: SessionTreeProjection): boolean {
  return tree.nodes.some((node) => node.active);
}

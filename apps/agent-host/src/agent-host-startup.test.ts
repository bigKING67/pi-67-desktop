import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopCapabilityBootstrapResult } from "./desktop-capability-bootstrap.js";
import type { ManagedPackageBundleResult } from "./managed-package-bundle.js";
import type { ManagedBrowser67McpResult } from "./managed-browser67-mcp-provision.js";
import type { RetiredTeamMcpCleanupResult } from "./retired-team-mcp-cleanup.js";
import {
  AgentHostStartupError,
  classifyAgentHostProfile,
  coordinateAgentHostStartup
} from "./agent-host-startup.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("Agent Host startup", () => {
  it("classifies missing, shared Pi TUI, and valid Desktop-managed Profiles", async () => {
    const root = await fixtureRoot();
    const missing = join(root, "missing");
    const shared = join(root, "shared");
    const managed = join(root, "managed");
    const invalidReceipt = join(root, "invalid-receipt");
    const sharedReceipt = join(root, "shared-receipt");
    const legacyReceipt = join(root, "legacy-receipt");
    await mkdir(shared);
    await mkdir(join(managed, "desktop-capabilities"), { recursive: true });
    await mkdir(join(invalidReceipt, "desktop-capabilities"), { recursive: true });
    await mkdir(join(sharedReceipt, "desktop-capabilities"), { recursive: true });
    await mkdir(join(legacyReceipt, "desktop-capabilities"), { recursive: true });
    await writeFile(join(shared, "settings.json"), "{}\n");
    await writeFile(
      join(managed, "desktop-capabilities", "state.json"),
      `${JSON.stringify(desktopCapabilityState())}\n`
    );
    await writeFile(
      join(invalidReceipt, "desktop-capabilities", "state.json"),
      "{\"schema\":\"pi67.desktop-capability-state.v1\"}\n"
    );
    await writeFile(
      join(sharedReceipt, "desktop-capabilities", "state.json"),
      `${JSON.stringify({ ...desktopCapabilityState(), profileOwnership: "shared" })}\n`
    );
    const legacyState = desktopCapabilityState();
    delete legacyState.profileOwnership;
    await writeFile(
      join(legacyReceipt, "desktop-capabilities", "state.json"),
      `${JSON.stringify(legacyState)}\n`
    );

    await expect(classifyAgentHostProfile(missing)).resolves.toBe("fresh");
    await expect(classifyAgentHostProfile(shared)).resolves.toBe("existing-shared");
    await expect(classifyAgentHostProfile(managed)).resolves.toBe("desktop-managed-upgrade");
    await expect(classifyAgentHostProfile(invalidReceipt)).resolves.toBe("existing-shared");
    await expect(classifyAgentHostProfile(sharedReceipt)).resolves.toBe("existing-shared");
    await expect(classifyAgentHostProfile(legacyReceipt)).resolves.toBe("existing-shared");
  });

  it("installs the complete Desktop path for a fresh Profile", async () => {
    const root = await fixtureRoot();
    const agentDir = join(root, "fresh");
    const calls: string[] = [];
    const environment = packagedEnvironment();

    const result = await coordinateAgentHostStartup({
      agentDir,
      environment,
      bootstrapCapabilities: async () => {
        calls.push("desktop-capabilities");
        return enabledCapabilities();
      },
      activateManagedPackages: async () => {
        calls.push("managed-packages");
        return enabledManagedPackages();
      },
      cleanupRetiredMcp: async () => {
        calls.push("retired-mcp-cleanup");
        return retiredCleanup("missing", agentDir);
      },
      provisionBrowser67Mcp: async () => {
        calls.push("browser67-mcp");
        return browser67Result("created", "missing", agentDir);
      },
      constructServer: () => {
        calls.push("server-construction");
        return { kind: "server" };
      }
    });

    expect(result).toMatchObject({
      server: { kind: "server" },
      startup: { profileMode: "fresh", status: "ready", issues: [] }
    });
    expect(environment.PI67_AGENT_PROFILE_FRESH).toBe("1");
    expect(calls).toEqual([
      "desktop-capabilities",
      "managed-packages",
      "retired-mcp-cleanup",
      "browser67-mcp",
      "server-construction"
    ]);
  });

  it("preserves an existing Pi TUI Profile and degrades conflicting Desktop MCP only", async () => {
    const root = await fixtureRoot();
    const agentDir = join(root, "shared");
    const files = await writeSharedProfile(agentDir);
    const before = await readFixtureFiles(agentDir, files);
    const cleanupRetiredMcp = vi.fn(async () => retiredCleanup("missing", agentDir));
    const bootstrapCapabilities = vi.fn(async () => enabledCapabilities());

    const result = await coordinateAgentHostStartup({
      agentDir,
      environment: packagedEnvironment(),
      bootstrapCapabilities,
      activateManagedPackages: async () => enabledManagedPackages(),
      cleanupRetiredMcp,
      provisionBrowser67Mcp: async () => browser67Result(
        "user-owned-conflict",
        "skipped",
        agentDir,
        ["tmwd_browser", "js-reverse"]
      ),
      constructServer: () => ({ kind: "server" })
    });

    expect(result.startup).toMatchObject({
      profileMode: "existing-shared",
      status: "degraded",
      issues: [{ stage: "browser67-mcp", code: "conflict" }]
    });
    expect(cleanupRetiredMcp).not.toHaveBeenCalled();
    expect(bootstrapCapabilities).toHaveBeenCalledWith(expect.objectContaining({
      profileOwnership: "shared"
    }));
    expect(await readFixtureFiles(agentDir, files)).toEqual(before);
  });

  it("keeps core startup available when a Desktop-managed upgrade cannot activate packages", async () => {
    const root = await fixtureRoot();
    const agentDir = join(root, "managed");
    await mkdir(join(agentDir, "desktop-capabilities"), { recursive: true });
    await writeFile(
      join(agentDir, "desktop-capabilities", "state.json"),
      `${JSON.stringify(desktopCapabilityState())}\n`
    );
    await writeFile(join(agentDir, "settings.json"), "{\"theme\":\"user\"}\n");
    const environment = packagedEnvironment();

    const result = await coordinateAgentHostStartup({
      agentDir,
      environment,
      bootstrapCapabilities: async ({ environment: target }) => {
        target.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify(["/managed/pi67-core"]);
        return enabledCapabilities();
      },
      activateManagedPackages: async () => {
        throw Object.assign(new Error("read only namespace"), { code: "EROFS" });
      },
      cleanupRetiredMcp: async () => retiredCleanup("missing", agentDir),
      provisionBrowser67Mcp: async () => browser67Result("unchanged", "unchanged", agentDir),
      constructServer: () => ({ kind: "server" })
    });

    expect(result.startup).toMatchObject({
      profileMode: "desktop-managed-upgrade",
      status: "degraded",
      issues: [{ stage: "managed-packages", code: "access-denied" }]
    });
    expect(environment.PI67_CAPABILITY_PACKAGE_PATHS).toBe(JSON.stringify(["/managed/pi67-core"]));
    expect(environment.PI67_MANAGED_NPM_ROOT).toBeUndefined();
    expect(await readFile(join(agentDir, "settings.json"), "utf8")).toBe("{\"theme\":\"user\"}\n");
  });

  it("bounds MCP cleanup, config, and cache conflicts as degraded startup issues", async () => {
    const result = await coordinateAgentHostStartup({
      agentDir: "/managed-profile",
      environment: packagedEnvironment(),
      classifyProfile: async () => "desktop-managed-upgrade",
      bootstrapCapabilities: async () => enabledCapabilities(),
      activateManagedPackages: async () => enabledManagedPackages(),
      cleanupRetiredMcp: async () => retiredCleanup("revision-conflict", "/managed-profile"),
      provisionBrowser67Mcp: async () => browser67Result(
        "invalid-json",
        "revision-conflict",
        "/managed-profile"
      ),
      constructServer: () => ({ kind: "server" })
    });

    expect(result.startup).toMatchObject({
      profileMode: "desktop-managed-upgrade",
      status: "degraded",
      issues: [
        { stage: "retired-mcp-cleanup", code: "conflict" },
        { stage: "browser67-mcp", code: "invalid-state" },
        { stage: "browser67-mcp", code: "conflict" }
      ],
      totalDurationMs: expect.any(Number),
      stageTimings: expect.arrayContaining([
        expect.objectContaining({ stage: "retired-mcp-cleanup", outcome: "degraded" }),
        expect.objectContaining({ stage: "browser67-mcp", outcome: "degraded" })
      ])
    });
  });

  it("removes only retired packaged copies after readiness and preserves Profile state", async () => {
    vi.useFakeTimers();
    const root = await fixtureRoot();
    const agentDir = join(root, "managed");
    const retired = [
      join(agentDir, "desktop-capabilities", "packages"),
      join(agentDir, "desktop-capabilities", "managed-packages", "active"),
      join(agentDir, "desktop-capabilities", "managed-packages", "previous"),
      join(agentDir, "desktop-capabilities", "managed-packages", "staging")
    ];
    const retained = [
      join(agentDir, "desktop-capabilities", "managed-packages", "state.json"),
      join(agentDir, "desktop-capabilities", "skill-packs", "suite", "state.json"),
      join(agentDir, "settings.json"),
      join(agentDir, "sessions", "session.jsonl")
    ];
    await Promise.all(retired.map((path) => mkdir(path, { recursive: true })));
    await Promise.all(retained.map(async (path) => {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "retained\n");
    }));

    const result = await coordinateAgentHostStartup({
      agentDir,
      environment: packagedEnvironment(),
      classifyProfile: async () => "desktop-managed-upgrade",
      bootstrapCapabilities: async () => ({
        ...enabledCapabilities(),
        managedRoot: join(agentDir, "desktop-capabilities"),
        projectionMode: "packaged-direct"
      }),
      activateManagedPackages: async () => ({
        ...enabledManagedPackages(),
        projectionMode: "packaged-direct"
      }),
      cleanupRetiredMcp: async () => retiredCleanup("missing", agentDir),
      provisionBrowser67Mcp: async () => browser67Result("unchanged", "unchanged", agentDir),
      constructServer: () => ({ kind: "server" })
    });

    expect(result.startup.capabilityProjectionMode).toBe("packaged-direct");
    for (const path of retired) await expect(stat(path)).resolves.toBeDefined();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    vi.useRealTimers();
    await vi.waitFor(async () => {
      for (const path of retired) await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    });
    for (const path of retained) expect(await readFile(path, "utf8")).toBe("retained\n");
  });

  it("fails a fresh packaged Profile closed on bundled integrity failure", async () => {
    const root = await fixtureRoot();
    const constructServer = vi.fn(() => ({ kind: "server" }));
    const starting = coordinateAgentHostStartup({
      agentDir: join(root, "fresh"),
      environment: packagedEnvironment(),
      bootstrapCapabilities: async () => {
        throw new Error("Desktop capability manifest failed integrity verification.");
      },
      constructServer
    });

    await expect(starting).rejects.toMatchObject({
      name: "AgentHostStartupError",
      profileMode: "fresh",
      issue: { stage: "desktop-capabilities", code: "integrity-failure" }
    });
    expect(constructServer).not.toHaveBeenCalled();
  });

  it("reports server construction as a deterministic fatal startup stage", async () => {
    const root = await fixtureRoot();
    await expect(coordinateAgentHostStartup({
      agentDir: join(root, "fresh"),
      environment: { PI67_DESKTOP: "0" },
      constructServer: () => {
        throw new Error("constructor failure");
      }
    })).rejects.toEqual(expect.objectContaining<Partial<AgentHostStartupError>>({
      name: "AgentHostStartupError",
      profileMode: "fresh",
      issue: { stage: "server-construction", code: "unknown" }
    }));
  });
});

function packagedEnvironment(): NodeJS.ProcessEnv {
  return {
    PI67_DESKTOP: "1",
    PI67_PACKAGED: "1",
    PI67_CAPABILITIES_ROOT: "/application/capabilities",
    PI67_NODE_EXECUTABLE: "/application/node"
  };
}

function enabledCapabilities(): DesktopCapabilityBootstrapResult {
  return {
    enabled: true,
    catalogVersion: "test.1",
    managedRoot: "/managed",
    packagePaths: ["/managed/pi67-core"],
    rules: "installed",
    agents: "user-owned"
  };
}

function enabledManagedPackages(): ManagedPackageBundleResult {
  return {
    enabled: true,
    activeRoot: "/managed/packages",
    packagePaths: ["/managed/package"],
    extensionPaths: ["/managed/extension.ts"],
    activated: true
  };
}

function retiredCleanup(
  status: RetiredTeamMcpCleanupResult["status"],
  agentDir: string
): RetiredTeamMcpCleanupResult {
  return { status, path: join(agentDir, "mcp.json") };
}

function browser67Result(
  status: ManagedBrowser67McpResult["status"],
  cacheStatus: ManagedBrowser67McpResult["cacheStatus"],
  agentDir: string,
  conflicts: ManagedBrowser67McpResult["conflicts"] = []
): ManagedBrowser67McpResult {
  return {
    status,
    path: join(agentDir, "mcp.json"),
    conflicts,
    cacheStatus,
    cachePath: join(agentDir, "mcp-cache.json"),
    invalidatedCacheServers: []
  };
}

function desktopCapabilityState(): Record<string, unknown> {
  return {
    schema: "pi67.desktop-capability-state.v1",
    catalogVersion: "test.1",
    packages: [{
      id: "pi67-core",
      displayName: "Pi-67 Core",
      resourceTypes: ["rules"],
      treeSha256: "a".repeat(64),
      installed: true,
      packageIndex: 0
    }],
    rules: "installed",
    agents: "user-owned",
    profileOwnership: "desktop",
    preparedAt: 1
  };
}

async function writeSharedProfile(agentDir: string): Promise<string[]> {
  const values: Record<string, string> = {
    "auth.json": "{\"provider\":\"user-owned\"}\n",
    "settings.json": "{\"theme\":\"user\"}\n",
    "models.json": "{\"providers\":[]}\n",
    "mcp.json": "{\"mcpServers\":{\"tmwd_browser\":{\"command\":\"user\"},\"js-reverse\":{\"command\":\"user\"}}}\n",
    "mcp-cache.json": "{\"version\":1,\"servers\":{}}\n",
    "AGENTS.md": "# User-owned Pi TUI instructions\n",
    "rules/user.md": "# User rule\n",
    "extensions/user.ts": "export default {};\n",
    "skills/user/SKILL.md": "# User skill\n",
    "prompts/user.md": "User prompt.\n",
    "themes/user.json": "{\"name\":\"user\"}\n",
    "sessions/session.jsonl": "{\"type\":\"session\"}\n"
  };
  for (const [relativePath, contents] of Object.entries(values)) {
    await mkdir(join(agentDir, relativePath, ".."), { recursive: true });
    await writeFile(join(agentDir, relativePath), contents);
  }
  return Object.keys(values);
}

async function readFixtureFiles(
  agentDir: string,
  relativePaths: string[]
): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(relativePaths.map(async (relativePath) => [
    relativePath,
    await readFile(join(agentDir, relativePath), "utf8")
  ])));
}

function fixtureRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi67-agent-host-startup-"));
}

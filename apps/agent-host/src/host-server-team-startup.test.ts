import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { PiSdkRuntimeOptions } from "@pi67/pi-runtime";
import { AgentHostServer } from "./host-server.js";
import { FakePort, FakeRuntime, attach, initialize, task } from "./host-server-multi-task-fixture.js";
import { TeamIndexSettingsClient } from "./context/team-index-settings-client.js";
import { LocalMemoryBrokerClient } from "./context/local-memory-broker-client.js";
import { canonicalTeamKnowledgeFromEnvironment } from "./context/host-team-knowledge.js";

it("accepts only exact Main-selected team modes", () => {
  expect(canonicalTeamKnowledgeFromEnvironment({})).toBe(false);
  expect(canonicalTeamKnowledgeFromEnvironment({ PI67_CANONICAL_TEAM_KNOWLEDGE: "0" })).toBe(false);
  expect(canonicalTeamKnowledgeFromEnvironment({ PI67_CANONICAL_TEAM_KNOWLEDGE: "1" })).toBe(true);
  for (const value of ["", "true", "false", " 1", "invalid-private-value"]) {
    expect(() => canonicalTeamKnowledgeFromEnvironment({ PI67_CANONICAL_TEAM_KNOWLEDGE: value }))
      .toThrow(/^Invalid Main-selected team knowledge mode\.$/u);
  }
});

it.each([
  { canonical: true, settings: true, privateMemory: false, expected: true },
  { canonical: true, settings: true, privateMemory: true, expected: true },
  { canonical: false, settings: true, privateMemory: true, expected: false },
  { canonical: true, settings: false, privateMemory: true, expected: false }
])("loads a Workspace-bound team route without starting private memory: %j", async (mode) => {
  const root = await mkdtemp(join(tmpdir(), "pi67-team-startup-"));
  const agentDir = join(root, "agent"), cwd = join(root, "workspace");
  await Promise.all([mkdir(agentDir), mkdir(cwd)]);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir); vi.stubEnv("PI67_STORAGE_ROOT", root);
  vi.stubEnv("PI67_SESSION_CATALOG_DIR", join(root, "catalog"));
  const parent = { postMessage: vi.fn() }, settings = new TeamIndexSettingsClient(parent);
  const privateBroker = new LocalMemoryBrokerClient(parent), received: PiSdkRuntimeOptions[] = [];
  let server: AgentHostServer | undefined;
  try {
    server = new AgentHostServer(async (options) => {
      received.push(options!); return new FakeRuntime("team-startup").asRuntime();
    }, { agentDir, sdkVersionLoader: async () => "0.81.1", modelCatalogRefreshOnStartup: false,
      canonicalTeamKnowledgeTools: mode.canonical, managedLocalMemory: mode.privateMemory,
      localMemoryBroker: privateBroker, ...(mode.settings ? { teamIndexSettings: settings } : {}) });
    const port = new FakePort(); await attach(server, port);
    const result = await initialize(port, task("workspace-team-startup", "task-team-startup"), { cwd, agentDir });
    expect(result.response.ok).toBe(true); expect(received).toHaveLength(1);
    expect(received[0]?.teamKnowledgeAccess !== undefined).toBe(mode.expected);
    expect(received[0]?.localMemory !== undefined).toBe(mode.privateMemory);
    expect(parent.postMessage).not.toHaveBeenCalled();
  } finally {
    try { await server?.shutdown(); settings.shutdown(); privateBroker.shutdown(); }
    finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
  }
});

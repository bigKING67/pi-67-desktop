import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots = [];
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const loaderUrl = new URL("../../packages/pi-workspace-resources/extensions/pi-rules-loader/index.ts", import.meta.url);

afterEach(async () => {
  vi.resetModules();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Pi rules loader Workspace trust", () => {
  it("keeps global rules while removing project rules after trust is revoked", async () => {
    const root = await temporaryRoot();
    const agentDir = join(root, "agent");
    const workspace = join(root, "workspace");
    await writeRule(join(agentDir, "rules", "global.md"), "Global rule", "GLOBAL_RULE_CONTENT");
    await writeRule(join(workspace, ".pi", "rules", "project.md"), "Project rule", "PROJECT_RULE_CONTENT");
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const harness = await createHarness();

    await harness.sessionStart(context(workspace, true, harness.branch));
    const trusted = await harness.beforeAgentStart({ prompt: "review", systemPrompt: "base" }, context(workspace, true, harness.branch));
    expect(trusted.systemPrompt).toContain("GLOBAL_RULE_CONTENT");
    expect(trusted.systemPrompt).toContain("PROJECT_RULE_CONTENT");

    const untrusted = await harness.beforeAgentStart({ prompt: "review", systemPrompt: "base" }, context(workspace, false, harness.branch));
    expect(untrusted.systemPrompt).toContain("GLOBAL_RULE_CONTENT");
    expect(untrusted.systemPrompt).not.toContain("PROJECT_RULE_CONTENT");
    expect(untrusted.systemPrompt).not.toContain(join(workspace, ".pi", "rules", "project.md"));
    expect(harness.appended.at(-1)?.data).toMatchObject({
      activeRulePaths: [join(agentDir, "rules", "global.md")]
    });
  });

  it("rebuilds project rules for the current Workspace before each agent start", async () => {
    const root = await temporaryRoot();
    const agentDir = join(root, "agent");
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    await writeRule(join(agentDir, "rules", "global.md"), "Global rule", "GLOBAL_RULE_CONTENT");
    await writeRule(join(workspaceA, ".agents", "rules", "project-a.md"), "Project A", "PROJECT_A_RULE_CONTENT");
    await writeRule(join(workspaceB, ".claude", "rules", "project-b.md"), "Project B", "PROJECT_B_RULE_CONTENT");
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const harness = await createHarness();

    await harness.sessionStart(context(workspaceA, true, harness.branch));
    const switched = await harness.beforeAgentStart({ prompt: "review", systemPrompt: "base" }, context(workspaceB, true, harness.branch));
    expect(switched.systemPrompt).toContain("GLOBAL_RULE_CONTENT");
    expect(switched.systemPrompt).toContain("PROJECT_B_RULE_CONTENT");
    expect(switched.systemPrompt).not.toContain("PROJECT_A_RULE_CONTENT");
  });

  it("clears persisted project state when untrusted mode has no global rules", async () => {
    const root = await temporaryRoot();
    const agentDir = join(root, "agent");
    const workspace = join(root, "workspace");
    await writeRule(join(workspace, ".pi", "rules", "project.md"), "Project rule", "PROJECT_RULE_CONTENT");
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const harness = await createHarness();

    await harness.sessionStart(context(workspace, true, harness.branch));
    await harness.beforeAgentStart({ prompt: "review", systemPrompt: "base" }, context(workspace, true, harness.branch));
    await expect(harness.beforeAgentStart({ prompt: "review", systemPrompt: "base" }, context(workspace, false, harness.branch))).resolves.toBeUndefined();
    expect(harness.appended.at(-1)?.data).toMatchObject({ activeRulePaths: [] });
  });
});

async function createHarness() {
  const handlers = new Map();
  const branch = [];
  const appended = [];
  const { default: piRulesLoader } = await import(loaderUrl.href);
  piRulesLoader({
    on(name, handler) {
      handlers.set(name, handler);
    },
    appendEntry(customType, data) {
      const entry = { type: "custom", customType, data };
      appended.push(entry);
      branch.push(entry);
    }
  });
  const sessionStart = handlers.get("session_start");
  const beforeAgentStart = handlers.get("before_agent_start");
  if (!sessionStart || !beforeAgentStart) throw new Error("Pi rules loader did not register required lifecycle handlers.");
  return {
    branch,
    appended,
    sessionStart: (ctx) => sessionStart({}, ctx),
    beforeAgentStart: (event, ctx) => beforeAgentStart(event, ctx)
  };
}

function context(cwd, trusted, branch) {
  return {
    cwd,
    isProjectTrusted: () => trusted,
    sessionManager: { getBranch: () => branch },
    ui: { notify: vi.fn() }
  };
}

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "pi67-rules-loader-"));
  roots.push(root);
  return root;
}

async function writeRule(path, title, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `---\ntriggers: review\n---\n# ${title}\n${content}\n`, "utf8");
}

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_TURN_SYSTEM_PROMPT } from "./agent-turn-profile.js";
import { createDesktopSessionServices } from "./session-services.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function servicesFor(toolsDisabled: boolean) {
  const root = await mkdtemp(join(tmpdir(), "pi67-agent-profile-"));
  roots.push(root);
  const cwd = join(root, "workspace"), agentDir = join(root, "agent");
  await Promise.all([mkdir(join(cwd, ".pi"), { recursive: true }), mkdir(join(agentDir, "skills", "secret"), { recursive: true })]);
  await Promise.all([
    writeFile(join(cwd, "AGENTS.md"), "PROJECT-SECRET-RULE"),
    writeFile(join(agentDir, "AGENTS.md"), "GLOBAL-SECRET-RULE"),
    writeFile(join(cwd, ".pi", "SYSTEM.md"), "OWNER-SYSTEM-PROMPT"),
    writeFile(join(agentDir, "skills", "secret", "SKILL.md"), "---\nname: secret\ndescription: owner skill\n---\nbody")
  ]);
  return createDesktopSessionServices({
    cwd, agentDir,
    getSafety: () => ({ cwd, trust: "trusted", taskToolMode: "auto", ...(toolsDisabled ? { toolsDisabled: true } : {}) }),
    requestApproval: async () => ({ status: "denied" })
  });
}

describe("Agent turn resource profile", () => {
  it("loads no context files, skills or owner system prompt, and replaces the system prompt last", async () => {
    const services = await servicesFor(true);
    const loader = services.resourceLoader;
    expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
    expect(loader.getSkills().skills).toEqual([]);
    expect(JSON.stringify(loader.getSystemPrompt() ?? "")).not.toContain("OWNER-SYSTEM-PROMPT");
    const names = loader.getExtensions().extensions.map((extension) => extension.path);
    expect(names.at(-1)).toContain("pi67-agent-turn-prompt");
    expect(AGENT_TURN_SYSTEM_PROMPT).toContain("no tools");
  });

  it("leaves ordinary Sessions on the owner's resources", async () => {
    const services = await servicesFor(false);
    expect(services.resourceLoader.getAgentsFiles().agentsFiles.map((file) => file.content)).toEqual(
      expect.arrayContaining(["GLOBAL-SECRET-RULE", "PROJECT-SECRET-RULE"])
    );
  });
});

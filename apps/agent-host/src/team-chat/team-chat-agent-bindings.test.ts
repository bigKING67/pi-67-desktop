import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TeamChatAgentBindingStore } from "./team-chat-agent-bindings.js";

const binding = (agentUserId: string, enabled = true) => ({
  agentUserId, workspaceId: "w1", projectId: "p1", model: { provider: "anthropic", id: "claude" }, enabled
});

describe("team chat agent bindings", () => {
  it("persists per-team bindings atomically with owner-only permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-agents-"));
    const store = new TeamChatAgentBindingStore(root);
    await store.put("t1", binding("a1"));
    await store.put("t1", binding("a2", false));
    await store.put("t2", binding("a3"));
    expect((await store.list("t1")).map((item) => item.agentUserId)).toEqual(["a1", "a2"]);
    expect(await store.enabledAgentIds("t1")).toEqual(["a1"]);
    const reread = new TeamChatAgentBindingStore(root);
    expect(await reread.find("t2", "a3")).toMatchObject({ projectId: "p1" });
    expect(await reread.hasEnabled()).toBe(true);
    await reread.retain("t1", new Set(["a2"]));
    await reread.remove("t2", "a3");
    expect(await reread.list("t1")).toEqual([binding("a2", false)]);
    expect(await reread.hasEnabled()).toBe(false);
    const file = join(root, "team-chat", "agents.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ schema: "pi67.team-chat-agents.v1", teams: { t1: [binding("a2", false)] } });
  });

  it("treats an unreadable or foreign file as no bindings and caps hosted Agents", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-agents-"));
    await mkdir(join(root, "team-chat"), { recursive: true });
    await writeFile(join(root, "team-chat", "agents.json"), "{\"schema\":\"other\"}");
    const store = new TeamChatAgentBindingStore(root);
    expect(await store.list("t1")).toEqual([]);
    for (const id of ["a1", "a2", "a3", "a4", "a5"]) await store.put("t1", binding(id));
    await expect(store.put("t1", binding("a6"))).rejects.toThrow(RangeError);
    expect(await store.list("t1")).toHaveLength(5);
  });
});

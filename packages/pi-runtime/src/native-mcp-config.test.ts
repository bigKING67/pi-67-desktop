import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { desktopMcpToolExposure, loadDesktopMcpConfig } from "./native-mcp-config.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(global: unknown, project?: unknown) {
  const root = await mkdtemp(join(tmpdir(), "pi67-native-config-"));
  roots.push(root);
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  await mkdir(join(root, ".pi"));
  const path = join(agentDir, "mcp.json");
  const original = JSON.stringify(global);
  await writeFile(path, original);
  if (project) await writeFile(join(root, ".pi", "mcp.json"), JSON.stringify(project));
  return { root, agentDir, path, original, load: (projectTrusted = true) => loadDesktopMcpConfig({
    agentDir, cwd: root, projectTrusted
  }) };
}

describe("native MCP configuration migration", () => {
  it("translates legacy direct, deferred, exclusions, timeout and bearer env without rewriting files", async () => {
    const f = await fixture({ unknownField: "preserved", settings: { requestTimeoutMs: 1500 }, mcpServers: {
      browser: { command: "synthetic", directTools: true },
      docs: { url: "https://synthetic.invalid", bearerTokenEnv: "SYNTHETIC_TOKEN", directTools: ["read"], excludeTools: ["delete"] }
    } });
    const config = f.load();
    expect(config.errors).toEqual([]);
    expect(config.servers[0]?.config).toMatchObject({ exposure: "direct", timeout: 1.5 });
    expect(config.servers[1]?.config).toMatchObject({ exposure: "deferred", toolExposure: { delete: "hidden" },
      headers: { Authorization: "Bearer ${SYNTHETIC_TOKEN}" } });
    expect(desktopMcpToolExposure(config.servers[1]!, "read", "deferred")).toBe("direct");
    expect(await readFile(f.path, "utf8")).toBe(f.original);
  });

  it("preserves normalized raw and old prefixed exclusions before native registration", async () => {
    const f = await fixture({ mcpServers: { "browser-mcp": { command: "synthetic",
      directTools: true, excludeTools: ["browser_my_tool", "browser_mcp_delete_file", "raw-tool"] } } });
    const entry = f.load().servers[0]!;
    for (const raw of ["my-tool", "delete_file", "raw_tool"]) {
      expect(desktopMcpToolExposure(entry, raw, "direct")).toBe("hidden");
    }
    expect(desktopMcpToolExposure(entry, "other", "direct")).toBe("direct");
  });

  it("preserves normalized direct lists while native exposure overrides take precedence", async () => {
    const f = await fixture({ mcpServers: { legacy: { command: "synthetic", directTools: ["a_b", "hidden_tool", "later_tool"],
      toolExposure: { "hidden*": "hidden", "later*": "deferred" } } } });
    const entry = f.load().servers[0]!;
    expect(desktopMcpToolExposure(entry, "a-b", "deferred")).toBe("direct");
    expect(desktopMcpToolExposure(entry, "hidden-tool", "hidden")).toBe("hidden");
    expect(desktopMcpToolExposure(entry, "later-tool", "deferred")).toBe("deferred");
  });

  it("rejects native Codemode exposure aliases after canonical validation", async () => {
    const f = await fixture({ mcpServers: { legacy: { command: "synthetic", toolExposure: { echo: "codemode-deferred" } } } });
    expect(f.load().servers).toEqual([]);
    expect(f.load().errors.join(" ")).toContain("Codemode");
  });

  it("loads project overrides only for a trusted project and does not fall back from invalid overrides", async () => {
    const f = await fixture({ mcpServers: { docs: { command: "global" } } },
      { mcpServers: { docs: { command: "project", exposure: "codemode" } } });
    expect(f.load(false).servers[0]?.config).toMatchObject({ command: "global" });
    expect(f.load().servers).toEqual([]);
    expect(f.load().errors.join(" ")).toContain("Codemode");
  });

  it("refuses ambiguous auth, unsupported SSE and project provider credentials with field-only errors", async () => {
    const f = await fixture({ mcpServers: {
      ambiguous: { url: "https://synthetic.invalid", bearerToken: "SYNTHETIC_SECRET", headers: { authorization: "SYNTHETIC_SECRET" } },
      old: { url: "https://synthetic.invalid", type: "sse" }
    } }, { mcpServers: { provider: { url: "https://synthetic.invalid", auth: { provider: "openai" } } } });
    const config = f.load();
    expect(config.servers).toEqual([]);
    expect(config.errors).toHaveLength(3);
    expect(config.errors.join(" ")).not.toContain("SYNTHETIC_SECRET");
  });

  it("rejects namespace collisions, oversized files and malformed JSON", async () => {
    const f = await fixture({ mcpServers: { "a--b": { command: "one" }, "a-_b": { command: "two" }, a__b: { command: "three" } } });
    expect(f.load().servers).toEqual([]);
    await writeFile(f.path, " ".repeat(1_000_001));
    expect(f.load().servers).toEqual([]);
    expect(f.load().errors.join(" ")).toContain("over 1 MB");
    await writeFile(f.path, "{broken");
    expect(f.load().servers).toEqual([]);
    expect(f.load().errors).toHaveLength(1);
  });

  it("does not restore a global namespace after a malformed project alias", async () => {
    const f = await fixture({ mcpServers: { "foo-bar": { command: "global" } } },
      { mcpServers: { foo_bar: { command: 7 } } });
    expect(f.load().servers).toEqual([]);
    expect(f.load().errors).toHaveLength(1);
  });
});

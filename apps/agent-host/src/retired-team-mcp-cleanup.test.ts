import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isDesktopManagedRetiredEntry,
  removeRetiredTeamMcpConfig
} from "./retired-team-mcp-cleanup.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("retired Team MCP cleanup", () => {
  it("recognizes only the former Desktop-owned endpoint and credential contract", () => {
    expect(isDesktopManagedRetiredEntry(managedEntry())).toBe(true);
    expect(isDesktopManagedRetiredEntry({ ...managedEntry(), url: "https://custom.example/mcp" })).toBe(false);
    expect(isDesktopManagedRetiredEntry({ ...managedEntry(), bearerTokenEnv: "CUSTOM_TOKEN" })).toBe(false);
  });

  it("does not create mcp.json when there is nothing to retire", async () => {
    const agentDir = await temporaryAgentDir();
    await expect(removeRetiredTeamMcpConfig({
      agentDir,
      environment: { PI67_DESKTOP: "1" }
    })).resolves.toMatchObject({ status: "missing" });
  });

  it("removes the former Desktop-owned entry and preserves every unrelated field", async () => {
    const agentDir = await temporaryAgentDir();
    const path = join(agentDir, "mcp.json");
    await writeFile(path, `${JSON.stringify({
      mcpServers: {
        tmwd_browser: { command: "node", args: ["server.mjs"] },
        "tavily-bridge": { ...managedEntry(), lifecycle: "keep-alive", custom: true }
      },
      settings: { toolPrefix: "short" },
      userField: true
    }, null, 2)}\n`, "utf8");

    await expect(removeRetiredTeamMcpConfig({
      agentDir,
      environment: { PI67_DESKTOP: "1" }
    })).resolves.toMatchObject({ status: "removed" });
    const config = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(config).toMatchObject({
      mcpServers: { tmwd_browser: { command: "node", args: ["server.mjs"] } },
      settings: { toolPrefix: "short" },
      userField: true
    });
    expect(config.mcpServers).not.toHaveProperty("tavily-bridge");
  });

  it("preserves a user-owned same-name endpoint and invalid JSON", async () => {
    const agentDir = await temporaryAgentDir();
    const path = join(agentDir, "mcp.json");
    const custom = `${JSON.stringify({
      mcpServers: { "tavily-bridge": { ...managedEntry(), url: "https://custom.example/mcp" } }
    })}\n`;
    await writeFile(path, custom, "utf8");
    await expect(removeRetiredTeamMcpConfig({
      agentDir,
      environment: { PI67_DESKTOP: "1" }
    })).resolves.toMatchObject({ status: "preserved-user" });
    expect(await readFile(path, "utf8")).toBe(custom);

    await writeFile(path, "{not-json", "utf8");
    await expect(removeRetiredTeamMcpConfig({
      agentDir,
      environment: { PI67_DESKTOP: "1" }
    })).resolves.toMatchObject({ status: "invalid-json" });
    expect(await readFile(path, "utf8")).toBe("{not-json");
  });

  it("lets an external revision win instead of overwriting it", async () => {
    const agentDir = await temporaryAgentDir();
    const path = join(agentDir, "mcp.json");
    const initial = `${JSON.stringify({ mcpServers: { "tavily-bridge": managedEntry() } })}\n`;
    const external = `${JSON.stringify({ mcpServers: { external: { command: "external" } } })}\n`;
    await writeFile(path, initial, "utf8");
    let reads = 0;

    await expect(removeRetiredTeamMcpConfig({
      agentDir,
      environment: { PI67_DESKTOP: "1" },
      readFile: async (filePath) => {
        reads += 1;
        const bytes = await readFile(filePath);
        if (reads === 1) await writeFile(path, external, "utf8");
        return bytes;
      }
    })).resolves.toMatchObject({ status: "revision-conflict" });
    expect(await readFile(path, "utf8")).toBe(external);
  });
});

async function temporaryAgentDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-retired-team-mcp-"));
  roots.push(root);
  return root;
}

function managedEntry(): Record<string, unknown> {
  return {
    url: "https://tavily.52671314.xyz/mcp",
    auth: "bearer",
    bearerTokenEnv: "TAVILY_BRIDGE_MCP_TOKEN",
    lifecycle: "lazy",
    requestTimeoutMs: 180_000,
    directTools: ["tavily_search", "tavily_extract"]
  };
}

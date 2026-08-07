import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TEAM_MCP_BASELINE,
  bootstrapTeamMcpConfig,
  planTeamMcpMerge
} from "./team-mcp-bootstrap.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempAgentDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi67-team-mcp-agent-"));
  tempDirs.push(dir);
  return dir;
}

describe("planTeamMcpMerge", () => {
  it("creates a baseline entry when missing", () => {
    const result = planTeamMcpMerge(undefined, DEFAULT_TEAM_MCP_BASELINE);
    expect(result.status).toBe("merged");
    expect(result.entry).toMatchObject({
      url: DEFAULT_TEAM_MCP_BASELINE.url,
      auth: "bearer",
      bearerTokenEnv: "TAVILY_BRIDGE_MCP_TOKEN"
    });
  });

  it("preserves a user-customized endpoint", () => {
    const result = planTeamMcpMerge({
      url: "https://example.com/mcp",
      auth: "bearer",
      bearerTokenEnv: "OTHER"
    }, DEFAULT_TEAM_MCP_BASELINE);
    expect(result.status).toBe("preserved-user");
    expect(result.entry.url).toBe("https://example.com/mcp");
  });

  it("fills missing fields on a compatible entry", () => {
    const result = planTeamMcpMerge({
      url: DEFAULT_TEAM_MCP_BASELINE.url,
      auth: "bearer",
      bearerTokenEnv: "TAVILY_BRIDGE_MCP_TOKEN"
    }, DEFAULT_TEAM_MCP_BASELINE);
    expect(result.status).toBe("merged");
    expect(result.entry.directTools).toEqual(["tavily_search", "tavily_extract"]);
    expect(result.entry.requestTimeoutMs).toBe(180_000);
  });
});

describe("bootstrapTeamMcpConfig", () => {
  it("skips outside the Desktop host", async () => {
    const agentDir = await tempAgentDir();
    const result = await bootstrapTeamMcpConfig({
      agentDir,
      environment: {}
    });
    expect(result.status).toBe("skipped");
  });

  it("creates mcp.json with the team server", async () => {
    const agentDir = await tempAgentDir();
    const result = await bootstrapTeamMcpConfig({
      agentDir,
      environment: { PI67_DESKTOP: "1" }
    });
    expect(result.status).toBe("created");
    const config = JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(config.mcpServers["tavily-bridge"]).toMatchObject({
      url: "https://tavily.52671314.xyz/mcp",
      bearerTokenEnv: "TAVILY_BRIDGE_MCP_TOKEN"
    });
    const text = await readFile(join(agentDir, "mcp.json"), "utf8");
    expect(text).not.toContain("mcp_");
  });

  it("merges without removing existing servers", async () => {
    const agentDir = await tempAgentDir();
    await writeFile(join(agentDir, "mcp.json"), `${JSON.stringify({
      mcpServers: {
        tmwd_browser: { command: "node", args: ["server.mjs"] }
      },
      settings: { toolPrefix: "short" }
    }, null, 2)}\n`, "utf8");

    const result = await bootstrapTeamMcpConfig({
      agentDir,
      environment: { PI67_DESKTOP: "1" }
    });
    expect(result.status).toBe("merged");
    const config = JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(config.mcpServers).sort()).toEqual(["tavily-bridge", "tmwd_browser"]);
  });

  it("does not overwrite a divergent user server", async () => {
    const agentDir = await tempAgentDir();
    await writeFile(join(agentDir, "mcp.json"), `${JSON.stringify({
      mcpServers: {
        "tavily-bridge": {
          url: "https://custom.example/mcp",
          auth: "bearer",
          bearerTokenEnv: "CUSTOM_TOKEN"
        }
      }
    }, null, 2)}\n`, "utf8");

    const result = await bootstrapTeamMcpConfig({
      agentDir,
      environment: { PI67_DESKTOP: "1" }
    });
    expect(result.status).toBe("preserved-user");
    const config = JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8")) as {
      mcpServers: Record<string, { url: string }>;
    };
    expect(config.mcpServers["tavily-bridge"]).toMatchObject({
      url: "https://custom.example/mcp"
    });
  });

  it("fails soft on invalid JSON", async () => {
    const agentDir = await tempAgentDir();
    await writeFile(join(agentDir, "mcp.json"), "{not-json", "utf8");
    const result = await bootstrapTeamMcpConfig({
      agentDir,
      environment: { PI67_DESKTOP: "1" }
    });
    expect(result.status).toBe("invalid-json");
    expect(await readFile(join(agentDir, "mcp.json"), "utf8")).toBe("{not-json");
  });

  it("fails closed when mcp.json changes after it was read", async () => {
    const agentDir = await tempAgentDir();
    const path = join(agentDir, "mcp.json");
    const initial = `${JSON.stringify({
      mcpServers: { tmwd_browser: { command: "node", args: ["server.mjs"] } }
    }, null, 2)}\n`;
    const external = `${JSON.stringify({
      mcpServers: { external: { command: "external-command" } }
    }, null, 2)}\n`;
    await writeFile(path, initial, "utf8");
    let mutated = false;

    const result = await bootstrapTeamMcpConfig({
      agentDir,
      environment: { PI67_DESKTOP: "1" },
      readFile: async (filePath) => {
        const bytes = await readFile(filePath);
        if (!mutated) {
          mutated = true;
          await writeFile(path, external, "utf8");
        }
        return bytes;
      }
    });

    expect(result.status).toBe("revision-conflict");
    expect(await readFile(path, "utf8")).toBe(external);
    expect(await readdir(agentDir)).toEqual(["mcp.json"]);
  });

  it("fails closed when mcp.json is created after an initial missing read", async () => {
    const agentDir = await tempAgentDir();
    const path = join(agentDir, "mcp.json");
    const external = `${JSON.stringify({
      mcpServers: { external: { command: "external-command" } }
    }, null, 2)}\n`;
    let reads = 0;

    const result = await bootstrapTeamMcpConfig({
      agentDir,
      environment: { PI67_DESKTOP: "1" },
      readFile: async (filePath) => {
        reads += 1;
        if (reads === 1) {
          await writeFile(path, external, "utf8");
          throw Object.assign(new Error(`ENOENT: no such file or directory, open '${filePath}'`), {
            code: "ENOENT"
          });
        }
        return readFile(filePath);
      }
    });

    expect(result.status).toBe("revision-conflict");
    expect(await readFile(path, "utf8")).toBe(external);
    expect(await readdir(agentDir)).toEqual(["mcp.json"]);
  });
});

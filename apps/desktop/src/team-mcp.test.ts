import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEAM_MCP_SERVER,
  loadTeamMcpServerDefinition,
  readTeamMcpToken,
  resolveTeamMcpResourcesRoot,
  teamMcpServerEntry
} from "./team-mcp.js";

describe("team-mcp helpers", () => {
  it("prefers the userData token over resources and local secrets", () => {
    const token = readTeamMcpToken({
      userTokenPath: "/user-data/team-mcp/tavily-bridge.token",
      resourcesRoot: "/resources/team-mcp",
      localSecretPath: "/secrets/token",
      exists: (path) => path === "/user-data/team-mcp/tavily-bridge.token",
      readFile: () => "mcp_userowned.secretvalue0123456789abcdef\n"
    });
    expect(token).toBe("mcp_userowned.secretvalue0123456789abcdef");
  });

  it("falls back to the local secret path in development", () => {
    const token = readTeamMcpToken({
      resourcesRoot: "/resources/team-mcp",
      localSecretPath: "/secrets/token",
      allowLocalSecretFallback: true,
      exists: (path) => path === "/secrets/token",
      readFile: () => "mcp_local.secretvalue0123456789abcdef\n"
    });
    expect(token).toBe("mcp_local.secretvalue0123456789abcdef");
  });

  it("does not use local secrets when fallback is disabled (packaged)", () => {
    const token = readTeamMcpToken({
      localSecretPath: "/secrets/token",
      allowLocalSecretFallback: false,
      exists: () => true,
      readFile: () => "mcp_local.secretvalue0123456789abcdef\n"
    });
    expect(token).toBeUndefined();
  });

  it("ignores invalid token formats", () => {
    const token = readTeamMcpToken({
      localSecretPath: "/secrets/token",
      exists: () => true,
      readFile: () => "tvly-not-a-client-token\n"
    });
    expect(token).toBeUndefined();
  });

  it("loads the bundled server definition when present", () => {
    const definition = loadTeamMcpServerDefinition({
      resourcesRoot: "/resources/team-mcp",
      exists: () => true,
      readFile: () => JSON.stringify({
        name: "tavily-bridge",
        url: "https://tavily.52671314.xyz/mcp",
        auth: "bearer",
        bearerTokenEnv: "TAVILY_BRIDGE_MCP_TOKEN",
        lifecycle: "lazy",
        requestTimeoutMs: 180000,
        directTools: ["tavily_search"]
      })
    });
    expect(definition.directTools).toEqual(["tavily_search"]);
    expect(teamMcpServerEntry(definition)).not.toHaveProperty("bearerToken");
  });

  it("returns the default server definition when the file is missing", () => {
    const definition = loadTeamMcpServerDefinition({
      resourcesRoot: "/missing",
      exists: () => false
    });
    expect(definition).toMatchObject({
      url: DEFAULT_TEAM_MCP_SERVER.url,
      bearerTokenEnv: "TAVILY_BRIDGE_MCP_TOKEN"
    });
  });

  it("resolves packaged and development resource roots", () => {
    expect(resolveTeamMcpResourcesRoot({
      packaged: true,
      resourcesPath: "/App/Resources"
    })).toBe(join("/App/Resources", "team-mcp"));
    expect(resolveTeamMcpResourcesRoot({
      packaged: false,
      repositoryRoot: "/repo"
    }).replaceAll("\\", "/")).toContain("apps/desktop/resources/team-mcp");
  });
});

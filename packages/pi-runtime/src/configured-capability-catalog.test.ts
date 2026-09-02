import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager, type SourceInfo } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { ConfiguredCapabilityCatalog } from "./configured-capability-catalog.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ConfiguredCapabilityCatalog", () => {
  it("recognizes effective configured and Desktop-managed Package sources without exposing raw sources", async () => {
    const root = await temporaryDirectory();
    const managedRoot = join(root, "managed");
    const managedPackage = join(managedRoot, "packages", "pi-workspace-resources");
    await mkdir(managedPackage, { recursive: true });
    const settingsManager = SettingsManager.inMemory({
      packages: ["pi-subagents", managedPackage]
    });
    const catalog = new ConfiguredCapabilityCatalog({
      agentDir: root,
      settingsManager,
      environment: { PI67_MANAGED_CAPABILITIES_ROOT: managedRoot }
    });
    await catalog.refresh();

    expect(catalog.resolvePackageSource(packageSource("npm:pi-subagents"))).toEqual({
      kind: "configured-package",
      sourceLabel: "已配置 Package · pi-subagents"
    });
    expect(catalog.resolvePackageSource(packageSource(managedPackage))).toEqual({
      kind: "managed-package",
      sourceLabel: "桌面托管 Package · pi-workspace-resources"
    });
    expect(catalog.resolvePackageSource(packageSource("npm:not-configured"))).toEqual({
      kind: "unconfigured",
      sourceLabel: "未配置的 Package"
    });
  });

  it("fails ambiguous Package identities closed", async () => {
    const root = await temporaryDirectory();
    const settingsManager = SettingsManager.inMemory({
      packages: ["pi-example", "npm:pi-example@1.0.0"]
    });
    const catalog = new ConfiguredCapabilityCatalog({ agentDir: root, settingsManager });
    await catalog.refresh();

    expect(catalog.resolvePackageSource(packageSource("npm:pi-example"))).toEqual({
      kind: "ambiguous",
      sourceLabel: "多个已配置 Package 来源"
    });
  });

  it("indexes configured MCP servers, unique proxy tools, and direct Tool names", async () => {
    const root = await temporaryDirectory();
    await writeMcpFixture(root, {
      mcpServers: {
        browser: { command: "redacted", directTools: false },
        memory: { command: "redacted", directTools: true },
        web: { url: "https://redacted.invalid", directTools: ["search"] }
      },
      settings: { toolPrefix: "short" }
    }, {
      version: 1,
      servers: {
        browser: { tools: [tool("scan"), tool("shared")] },
        memory: { tools: [tool("remember"), tool("shared")] },
        web: { tools: [tool("search")] }
      }
    });
    const catalog = new ConfiguredCapabilityCatalog({
      agentDir: root,
      settingsManager: SettingsManager.inMemory()
    });
    await catalog.refresh();

    expect(catalog.resolveMcpServer("browser")).toMatchObject({
      kind: "configured-mcp",
      serverName: "browser",
      transport: "stdio"
    });
    expect(catalog.resolveMcpTool("scan")).toMatchObject({
      kind: "configured-mcp",
      serverName: "browser",
      toolName: "scan",
      schemaDigest: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    expect(catalog.resolveMcpTool("shared")).toEqual({
      kind: "ambiguous",
      sourceLabel: "多个已配置 MCP server"
    });
    expect(catalog.resolveMcpTool("shared", "memory")).toMatchObject({
      kind: "configured-mcp",
      serverName: "memory"
    });
    expect(catalog.resolveDirectMcpTool("memory_remember")).toMatchObject({
      kind: "configured-mcp",
      serverName: "memory",
      toolName: "remember"
    });
    expect(catalog.resolveDirectMcpTool("web_search")).toMatchObject({
      kind: "configured-mcp",
      serverName: "web",
      transport: "http"
    });
  });

  it("does not trust malformed or oversized MCP metadata", async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, "mcp.json"), "{".repeat(32), "utf8");
    await writeFile(join(root, "mcp-cache.json"), "x".repeat(8_000_001), "utf8");
    const catalog = new ConfiguredCapabilityCatalog({
      agentDir: root,
      settingsManager: SettingsManager.inMemory()
    });
    await catalog.refresh();

    expect(catalog.resolveMcpServer("browser").kind).toBe("unconfigured");
    expect(catalog.resolveMcpTool("scan").kind).toBe("unconfigured");
  });
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-configured-capabilities-"));
  temporaryDirectories.push(root);
  return root;
}

async function writeMcpFixture(root: string, config: unknown, cache: unknown): Promise<void> {
  await Promise.all([
    writeFile(join(root, "mcp.json"), JSON.stringify(config), "utf8"),
    writeFile(join(root, "mcp-cache.json"), JSON.stringify(cache), "utf8")
  ]);
}

function tool(name: string) {
  return { name, description: "must not enter the catalog", inputSchema: { type: "object" } };
}

function packageSource(source: string): SourceInfo {
  return { path: source, source, scope: "user", origin: "package" };
}

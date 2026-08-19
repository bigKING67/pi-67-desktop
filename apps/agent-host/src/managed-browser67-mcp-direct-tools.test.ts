import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { provisionManagedBrowser67Mcp } from "./managed-browser67-mcp-provision.js";

describe("managed browser67 direct tools migration", () => {
  it("migrates the receipted browser server and invalidates only its cache", async () => {
    const fixture = await createFixture();
    const legacyBrowserSpec = serverSpec(fixture, "browser");
    const reverseSpec = serverSpec(fixture, "js-reverse");
    const browser67Commit = "1".repeat(40);
    await writeFile(fixture.mcpPath, JSON.stringify({
      mcpServers: { tmwd_browser: legacyBrowserSpec, "js-reverse": reverseSpec },
      pi67ManagedMcp: {
        schema: "pi67.browser67-mcp.v1",
        servers: {
          tmwd_browser: managedReceipt(browser67Commit, legacyBrowserSpec),
          "js-reverse": managedReceipt(browser67Commit, reverseSpec, true)
        }
      }
    }), "utf8");
    const reverseCache = cacheEntry("reverse-tool");
    await writeFile(fixture.cachePath, JSON.stringify({
      version: 1,
      servers: {
        tmwd_browser: cacheEntry("mcp-proxy-tool"),
        "js-reverse": reverseCache
      }
    }), "utf8");

    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({
      status: "updated",
      conflicts: [],
      cacheStatus: "updated",
      invalidatedCacheServers: ["tmwd_browser"]
    });
    const config = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    expect(config.mcpServers.tmwd_browser).toEqual({ ...legacyBrowserSpec, directTools: true });
    expect(config.mcpServers["js-reverse"]).toEqual(reverseSpec);
    expect(JSON.parse(await readFile(fixture.cachePath, "utf8"))).toEqual({
      version: 1,
      servers: { "js-reverse": reverseCache }
    });
  });
});

function serverSpec(fixture: Awaited<ReturnType<typeof createFixture>>, server: string) {
  return {
    command: fixture.nodeExecutable,
    args: [join(fixture.browser67Root, "src", "mcp", server, "server.mjs")]
  };
}

function cacheEntry(toolName: string) {
  return {
    configHash: "a".repeat(64),
    tools: [{ name: toolName, inputSchema: { type: "object" } }],
    resources: [],
    cachedAt: 1
  };
}

function managedReceipt(browser67Commit: string, spec: unknown, acknowledged = false) {
  const receipt = {
    kind: "browser67-mcp",
    browser67Commit,
    specSha256: createHash("sha256").update(stableJson(spec)).digest("hex")
  };
  return acknowledged ? {
    ...receipt,
    cacheRevisionSha256: createHash("sha256").update(stableJson({
      browser67Commit,
      specSha256: receipt.specSha256
    })).digest("hex")
  } : receipt;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pi67-browser67-direct-tools-"));
  const agentDir = join(root, "agent");
  const browser67Root = join(agentDir, "desktop-capabilities", "packages", "browser67");
  const nodeExecutable = join(root, "toolchain", "node");
  await Promise.all([
    mkdir(join(browser67Root, "src", "mcp", "browser"), { recursive: true }),
    mkdir(join(browser67Root, "src", "mcp", "js-reverse"), { recursive: true }),
    mkdir(join(root, "toolchain"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(browser67Root, "package.json"), JSON.stringify({
      name: "browser67",
      version: "0.4.0",
      gitHead: "1".repeat(40)
    }), "utf8"),
    writeFile(join(browser67Root, "src", "mcp", "browser", "server.mjs"), "", "utf8"),
    writeFile(join(browser67Root, "src", "mcp", "js-reverse", "server.mjs"), "", "utf8"),
    writeFile(nodeExecutable, "", "utf8")
  ]);
  return {
    agentDir,
    browser67Root,
    nodeExecutable,
    mcpPath: join(agentDir, "mcp.json"),
    cachePath: join(agentDir, "mcp-cache.json"),
    environment: { PI67_DESKTOP: "1", PI67_NODE_EXECUTABLE: nodeExecutable }
  };
}

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { provisionManagedBrowser67Mcp } from "./managed-browser67-mcp-provision.js";

describe("managed browser67 MCP provision", () => {
  it("creates both servers with private Node, preserves unrelated config, and becomes idempotent", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.mcpPath, JSON.stringify({
      settings: { toolPrefix: "server" },
      mcpServers: { linear: { url: "https://redacted.invalid/mcp" } }
    }), "utf8");

    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({ status: "updated" });
    const config = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    expect(config.settings).toEqual({ toolPrefix: "server" });
    expect(config.mcpServers.linear).toEqual({ url: "https://redacted.invalid/mcp" });
    expect(config.mcpServers.tmwd_browser).toEqual({
      command: fixture.nodeExecutable,
      args: [join(fixture.browser67Root, "src", "mcp", "browser", "server.mjs")],
      directTools: true
    });
    expect(config.mcpServers["js-reverse"]).toEqual({
      command: fixture.nodeExecutable,
      args: [join(fixture.browser67Root, "src", "mcp", "js-reverse", "server.mjs")]
    });
    expect(config.pi67ManagedMcp.schema).toBe("pi67.browser67-mcp.v1");
    expect(config.pi67ManagedMcp.servers.tmwd_browser.cacheRevisionSha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({
      status: "unchanged",
      cacheStatus: "skipped"
    });
  });

  it("resolves the exact packaged browser67 path from the dual-root capability projection", async () => {
    const fixture = await createFixture(true);

    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({ status: "created" });

    const config = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    expect(config.mcpServers.tmwd_browser.args).toEqual([
      join(fixture.browser67Root, "src", "mcp", "browser", "server.mjs")
    ]);
    expect(config.mcpServers["js-reverse"].args).toEqual([
      join(fixture.browser67Root, "src", "mcp", "js-reverse", "server.mjs")
    ]);
  });

  it("invalidates only managed browser67 cache entries and preserves unrelated servers", async () => {
    const fixture = await createFixture();
    const unrelated = cacheEntry("linear-tool");
    await writeFile(fixture.cachePath, JSON.stringify({
      version: 1,
      servers: {
        linear: unrelated,
        tmwd_browser: cacheEntry("stale-browser-tool"),
        "js-reverse": cacheEntry("stale-reverse-tool")
      }
    }), "utf8");

    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({
      status: "created",
      cacheStatus: "updated",
      invalidatedCacheServers: ["tmwd_browser", "js-reverse"]
    });
    const cache = JSON.parse(await readFile(fixture.cachePath, "utf8"));
    expect(cache).toEqual({ version: 1, servers: { linear: unrelated } });
    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({
      status: "unchanged",
      cacheStatus: "skipped",
      invalidatedCacheServers: []
    });
  });

  it("migrates the exact retired Windows browser67 pair and invalidates its stale cache", async () => {
    const fixture = await createFixture(true);
    const homeDirectory = "C:\\Users\\Groland";
    const legacyRoot = `${homeDirectory}\\.agents\\packages\\browser67`;
    await mkdir(fixture.agentDir, { recursive: true });
    await writeFile(fixture.mcpPath, JSON.stringify({
      settings: { toolPrefix: "server" },
      mcpServers: {
        linear: { url: "https://redacted.invalid/mcp" },
        tmwd_browser: {
          command: "C:\\Users\\Groland\\scoop\\apps\\nodejs-lts\\current\\bin\\node.exe",
          args: [`${legacyRoot}\\src\\mcp\\browser\\server.mjs`],
          env: {
            BROWSER_STRUCTURED_TMWD_MODE: "tmwd",
            BROWSER_STRUCTURED_TMWD_TRANSPORT: "auto",
            BROWSER_STRUCTURED_TMWD_WS_ENDPOINT: "ws://127.0.0.1:18765",
            BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT: "http://127.0.0.1:18766/link"
          }
        },
        "js-reverse": {
          command: "node",
          args: [`${legacyRoot}\\src\\mcp\\js-reverse\\server.mjs`]
        }
      }
    }), "utf8");
    const unrelated = cacheEntry("linear-tool");
    await writeFile(fixture.cachePath, JSON.stringify({
      version: 1,
      servers: {
        linear: unrelated,
        tmwd_browser: cacheEntry("stale-browser-tool"),
        "js-reverse": cacheEntry("stale-reverse-tool")
      }
    }), "utf8");

    await expect(provisionManagedBrowser67Mcp({
      ...fixture,
      homeDirectory
    })).resolves.toMatchObject({
      status: "updated",
      conflicts: [],
      migratedLegacyServers: ["tmwd_browser", "js-reverse"],
      cacheStatus: "updated",
      invalidatedCacheServers: ["tmwd_browser", "js-reverse"]
    });

    const config = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    expect(config.settings).toEqual({ toolPrefix: "server" });
    expect(config.mcpServers.linear).toEqual({ url: "https://redacted.invalid/mcp" });
    expect(config.mcpServers.tmwd_browser).toEqual({
      command: fixture.nodeExecutable,
      args: [join(fixture.browser67Root, "src", "mcp", "browser", "server.mjs")],
      directTools: true
    });
    expect(config.mcpServers["js-reverse"]).toEqual({
      command: fixture.nodeExecutable,
      args: [join(fixture.browser67Root, "src", "mcp", "js-reverse", "server.mjs")]
    });
    expect(config.pi67ManagedMcp.schema).toBe("pi67.browser67-mcp.v1");
    expect(JSON.parse(await readFile(fixture.cachePath, "utf8"))).toEqual({
      version: 1,
      servers: { linear: unrelated }
    });
    await expect(provisionManagedBrowser67Mcp({
      ...fixture,
      homeDirectory
    })).resolves.toMatchObject({
      status: "unchanged",
      migratedLegacyServers: [],
      cacheStatus: "skipped"
    });
  });

  it("does not claim a partial or arbitrary browser67 checkout as a retired Desktop pair", async () => {
    const fixture = await createFixture();
    const homeDirectory = "C:\\Users\\Groland";
    const legacyRoot = `${homeDirectory}\\.agents\\packages\\browser67`;
    await writeFile(fixture.mcpPath, JSON.stringify({
      mcpServers: {
        tmwd_browser: {
          command: "node.exe",
          args: [`${legacyRoot}\\src\\mcp\\browser\\server.mjs`]
        },
        "js-reverse": {
          command: "node.exe",
          args: ["C:\\Users\\Groland\\source\\browser67\\src\\mcp\\js-reverse\\server.mjs"]
        }
      }
    }), "utf8");

    await expect(provisionManagedBrowser67Mcp({
      ...fixture,
      homeDirectory
    })).resolves.toMatchObject({
      status: "user-owned-conflict",
      conflicts: ["tmwd_browser", "js-reverse"],
      migratedLegacyServers: [],
      cacheStatus: "skipped"
    });
  });

  it("preserves an exact-path browser67 pair when its legacy environment was customized", async () => {
    const fixture = await createFixture();
    const homeDirectory = "C:\\Users\\Groland";
    const legacyRoot = `${homeDirectory}\\.agents\\packages\\browser67`;
    await writeFile(fixture.mcpPath, JSON.stringify({
      mcpServers: {
        tmwd_browser: {
          command: "node.exe",
          args: [`${legacyRoot}\\src\\mcp\\browser\\server.mjs`],
          env: { BROWSER_STRUCTURED_TMWD_WS_ENDPOINT: "custom-endpoint" }
        },
        "js-reverse": {
          command: "node.exe",
          args: [`${legacyRoot}\\src\\mcp\\js-reverse\\server.mjs`]
        }
      }
    }), "utf8");

    await expect(provisionManagedBrowser67Mcp({
      ...fixture,
      homeDirectory
    })).resolves.toMatchObject({
      status: "user-owned-conflict",
      conflicts: ["tmwd_browser", "js-reverse"],
      migratedLegacyServers: []
    });
  });

  it("fails closed for user-owned same-name entries and invalid JSON", async () => {
    const conflict = await createFixture();
    await writeFile(conflict.mcpPath, JSON.stringify({
      mcpServers: { tmwd_browser: { command: "user-node", args: ["user-server"] } }
    }), "utf8");
    await writeFile(conflict.cachePath, JSON.stringify({
      version: 1,
      servers: { tmwd_browser: cacheEntry("user-cache") }
    }), "utf8");
    await expect(provisionManagedBrowser67Mcp(conflict)).resolves.toMatchObject({
      status: "user-owned-conflict",
      path: conflict.mcpPath,
      conflicts: ["tmwd_browser"],
      migratedLegacyServers: [],
      cacheStatus: "skipped",
      invalidatedCacheServers: []
    });
    expect(JSON.parse(await readFile(conflict.mcpPath, "utf8")).mcpServers["js-reverse"]).toBeUndefined();
    expect(JSON.parse(await readFile(conflict.cachePath, "utf8")).servers.tmwd_browser).toEqual(cacheEntry("user-cache"));

    const invalid = await createFixture();
    await writeFile(invalid.mcpPath, "{invalid", "utf8");
    await expect(provisionManagedBrowser67Mcp(invalid)).resolves.toMatchObject({ status: "invalid-json" });
    expect(await readFile(invalid.mcpPath, "utf8")).toBe("{invalid");
  });

  it("updates only previously receipted managed entries when browser67 advances", async () => {
    const fixture = await createFixture();
    await provisionManagedBrowser67Mcp(fixture);
    const first = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    first.mcpServers.linear = { command: "linear" };
    await writeFile(fixture.mcpPath, JSON.stringify(first), "utf8");
    await writeFile(join(fixture.browser67Root, "package.json"), JSON.stringify({
      name: "browser67",
      version: "0.4.0",
      gitHead: "2".repeat(40)
    }), "utf8");

    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({ status: "updated" });
    const updated = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    expect(updated.mcpServers.linear).toEqual({ command: "linear" });
    expect(updated.pi67ManagedMcp.servers.tmwd_browser.browser67Commit).toBe("2".repeat(40));
  });

  it("fails closed on invalid cache JSON after provisioning mcp.json", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.cachePath, "{invalid", "utf8");

    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({
      status: "created",
      cacheStatus: "invalid-json",
      invalidatedCacheServers: []
    });
    expect(await readFile(fixture.cachePath, "utf8")).toBe("{invalid");
    const config = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    expect(config.mcpServers.tmwd_browser).toBeDefined();
    expect(config.mcpServers["js-reverse"]).toBeDefined();
    expect(config.pi67ManagedMcp.servers.tmwd_browser.cacheRevisionSha256).toBeUndefined();
  });

  it("acknowledges a revision change when the cache has no managed entries", async () => {
    const fixture = await createFixture();
    await provisionManagedBrowser67Mcp(fixture);
    await writeFile(join(fixture.browser67Root, "package.json"), JSON.stringify({
      name: "browser67",
      version: "0.4.0",
      gitHead: "2".repeat(40)
    }), "utf8");
    const unrelated = cacheEntry("linear-tool");
    await writeFile(fixture.cachePath, JSON.stringify({
      version: 1,
      servers: { linear: unrelated }
    }), "utf8");

    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({
      status: "updated",
      cacheStatus: "unchanged",
      invalidatedCacheServers: []
    });
    expect(JSON.parse(await readFile(fixture.cachePath, "utf8"))).toEqual({
      version: 1,
      servers: { linear: unrelated }
    });
    const config = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    expect(config.pi67ManagedMcp.servers.tmwd_browser.browser67Commit).toBe("2".repeat(40));
    expect(config.pi67ManagedMcp.servers.tmwd_browser.cacheRevisionSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("reports a cache compare-and-swap race after mcp.json provision succeeds", async () => {
    const fixture = await createFixture();
    await provisionManagedBrowser67Mcp(fixture);
    await writeFile(join(fixture.browser67Root, "package.json"), JSON.stringify({
      name: "browser67",
      version: "0.4.0",
      gitHead: "2".repeat(40)
    }), "utf8");
    const initialCache = Buffer.from(JSON.stringify({
      version: 1,
      servers: {
        linear: cacheEntry("linear-tool"),
        tmwd_browser: cacheEntry("stale-browser-tool"),
        "js-reverse": cacheEntry("stale-reverse-tool")
      }
    }));
    await writeFile(fixture.cachePath, initialCache);
    let cacheReads = 0;

    await expect(provisionManagedBrowser67Mcp({
      ...fixture,
      readFile: async (path) => {
        if (path !== fixture.cachePath) return readFile(path);
        cacheReads += 1;
        return cacheReads === 1 ? initialCache : Buffer.from("externally changed");
      }
    })).resolves.toMatchObject({
      status: "updated",
      cacheStatus: "revision-conflict",
      invalidatedCacheServers: []
    });
    const config = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    expect(config.pi67ManagedMcp.servers.tmwd_browser.browser67Commit).toBe("2".repeat(40));
    expect(config.pi67ManagedMcp.servers.tmwd_browser.cacheRevisionSha256).toBeUndefined();
    expect(await readFile(fixture.cachePath)).toEqual(initialCache);
  });

  it("detects a compare-and-swap revision race", async () => {
    const fixture = await createFixture();
    const initial = Buffer.from(JSON.stringify({ mcpServers: { linear: { command: "linear" } } }));
    await writeFile(fixture.mcpPath, initial);
    let reads = 0;
    await expect(provisionManagedBrowser67Mcp({
      ...fixture,
      readFile: async () => {
        reads += 1;
        return reads === 1 ? initial : Buffer.from("externally changed");
      }
    })).resolves.toMatchObject({ status: "revision-conflict", cacheStatus: "skipped" });
  });
});

function cacheEntry(toolName: string) {
  return {
    configHash: "a".repeat(64),
    tools: [{ name: toolName, inputSchema: { type: "object" } }],
    resources: [],
    cachedAt: 1
  };
}

async function createFixture(packagedDirect = false) {
  const root = await mkdtemp(join(tmpdir(), "pi67-browser67-mcp-"));
  const agentDir = join(root, "agent");
  const capabilitiesRoot = join(root, "capabilities");
  const managedRoot = join(agentDir, "desktop-capabilities");
  const browser67Root = packagedDirect
    ? join(capabilitiesRoot, "packages", "browser67")
    : join(managedRoot, "packages", "browser67");
  const nodeExecutable = join(root, "toolchain", "node");
  const mcpPath = join(agentDir, "mcp.json");
  const cachePath = join(agentDir, "mcp-cache.json");
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
    mcpPath,
    cachePath,
    environment: {
      PI67_DESKTOP: "1",
      PI67_NODE_EXECUTABLE: nodeExecutable,
      ...(packagedDirect ? {
        PI67_BUNDLED_CAPABILITIES_ROOT: capabilitiesRoot,
        PI67_MANAGED_CAPABILITIES_ROOT: managedRoot,
        PI67_CAPABILITY_PACKAGE_PATHS: JSON.stringify([browser67Root])
      } : {})
    }
  };
}

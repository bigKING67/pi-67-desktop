import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { provisionManagedBrowser67Mcp } from "./managed-browser67-mcp-provision.js";

describe("managed browser67 MCP provision", () => {
  it("creates native exposure declarations, preserves unrelated config, and leaves old cache bytes intact", async () => {
    const fixture = await createFixture();
    const cacheBytes = Buffer.from("{old adapter cache bytes}");
    await Promise.all([
      writeFile(fixture.mcpPath, JSON.stringify({
        settings: { toolPrefix: "server" },
        mcpServers: { linear: { url: "https://redacted.invalid/mcp" } }
      }), "utf8"),
      writeFile(fixture.cachePath, cacheBytes)
    ]);

    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({ status: "updated" });
    const config = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    expect(config.settings).toEqual({ toolPrefix: "server" });
    expect(config.mcpServers.linear).toEqual({ url: "https://redacted.invalid/mcp" });
    expect(config.mcpServers.tmwd_browser).toEqual({
      command: fixture.nodeExecutable,
      args: [join(fixture.browser67Root, "src", "mcp", "browser", "server.mjs")],
      exposure: "direct"
    });
    expect(config.mcpServers["js-reverse"]).toEqual({
      command: fixture.nodeExecutable,
      args: [join(fixture.browser67Root, "src", "mcp", "js-reverse", "server.mjs")],
      exposure: "deferred"
    });
    expect(config.pi67ManagedMcp.schema).toBe("pi67.browser67-mcp.v1");
    expect(await readFile(fixture.cachePath)).toEqual(cacheBytes);
    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({ status: "unchanged" });
  });

  it("resolves the exact browser67 path from the active capability projection", async () => {
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

  it("migrates only the exact retired browser67 pair and preserves legacy cache bytes", async () => {
    const fixture = await createFixture();
    const homeDirectory = "C:\\Users\\Groland";
    const legacyRoot = `${homeDirectory}\\.agents\\packages\\browser67`;
    const cacheBytes = Buffer.from("legacy user mcp cache");
    await Promise.all([
      writeFile(fixture.mcpPath, JSON.stringify({
        settings: { toolPrefix: "server" },
        mcpServers: {
          linear: { url: "https://redacted.invalid/mcp" },
          tmwd_browser: { command: "node.exe", args: [`${legacyRoot}\\src\\mcp\\browser\\server.mjs`] },
          "js-reverse": { command: "node.exe", args: [`${legacyRoot}\\src\\mcp\\js-reverse\\server.mjs`] }
        }
      }), "utf8"),
      writeFile(fixture.cachePath, cacheBytes)
    ]);

    await expect(provisionManagedBrowser67Mcp({ ...fixture, homeDirectory })).resolves.toMatchObject({
      status: "updated",
      conflicts: [],
      migratedLegacyServers: ["tmwd_browser", "js-reverse"]
    });
    const config = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    expect(config.mcpServers.tmwd_browser.exposure).toBe("direct");
    expect(config.mcpServers["js-reverse"].exposure).toBe("deferred");
    expect(await readFile(fixture.cachePath)).toEqual(cacheBytes);
  });

  it("migrates the receipted managed pair from directTools without touching its old cache", async () => {
    const fixture = await createFixture();
    const tmwdBrowser = serverSpec(fixture, "browser");
    const jsReverse = serverSpec(fixture, "js-reverse");
    const cacheBytes = Buffer.from("previous adapter cache");
    await Promise.all([
      writeFile(fixture.mcpPath, JSON.stringify({
        mcpServers: { tmwd_browser: { ...tmwdBrowser, directTools: true }, "js-reverse": jsReverse },
        pi67ManagedMcp: {
          schema: "pi67.browser67-mcp.v1",
          servers: {
            tmwd_browser: managedReceipt("1".repeat(40), { ...tmwdBrowser, directTools: true }),
            "js-reverse": managedReceipt("1".repeat(40), jsReverse)
          }
        }
      }), "utf8"),
      writeFile(fixture.cachePath, cacheBytes)
    ]);

    await expect(provisionManagedBrowser67Mcp(fixture)).resolves.toMatchObject({
      status: "updated",
      conflicts: []
    });
    const config = JSON.parse(await readFile(fixture.mcpPath, "utf8"));
    expect(config.mcpServers.tmwd_browser).toEqual({ ...tmwdBrowser, exposure: "direct" });
    expect(config.mcpServers["js-reverse"]).toEqual({ ...jsReverse, exposure: "deferred" });
    expect(await readFile(fixture.cachePath)).toEqual(cacheBytes);
  });

  it("fails closed for user-owned names and invalid JSON", async () => {
    const conflict = await createFixture();
    await writeFile(conflict.mcpPath, JSON.stringify({
      mcpServers: { tmwd_browser: { command: "user-node", args: ["user-server"] } }
    }), "utf8");
    await expect(provisionManagedBrowser67Mcp(conflict)).resolves.toMatchObject({
      status: "user-owned-conflict",
      conflicts: ["tmwd_browser"]
    });
    expect(JSON.parse(await readFile(conflict.mcpPath, "utf8")).mcpServers["js-reverse"]).toBeUndefined();

    const invalid = await createFixture();
    await writeFile(invalid.mcpPath, "{invalid", "utf8");
    await expect(provisionManagedBrowser67Mcp(invalid)).resolves.toMatchObject({ status: "invalid-json" });
    expect(await readFile(invalid.mcpPath, "utf8")).toBe("{invalid");
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
    })).resolves.toMatchObject({ status: "revision-conflict" });
  });
});

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
      name: "browser67", version: "0.4.0", gitHead: "1".repeat(40)
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

function serverSpec(fixture: Awaited<ReturnType<typeof createFixture>>, server: string) {
  return {
    command: fixture.nodeExecutable,
    args: [join(fixture.browser67Root, "src", "mcp", server, "server.mjs")]
  };
}

function managedReceipt(browser67Commit: string, spec: unknown) {
  return {
    kind: "browser67-mcp",
    browser67Commit,
    specSha256: createHash("sha256").update(stableJson(spec)).digest("hex")
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

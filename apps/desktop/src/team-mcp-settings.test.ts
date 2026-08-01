import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TeamMcpSettingsStore,
  normalizeClientToken,
  safeTokenPrefix
} from "./team-mcp-settings.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function userDataRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi67-team-mcp-settings-"));
  tempDirs.push(dir);
  return dir;
}

describe("TeamMcpSettingsStore", () => {
  it("starts unconfigured", async () => {
    const store = new TeamMcpSettingsStore(await userDataRoot());
    await expect(store.status()).resolves.toMatchObject({
      configured: false,
      serverName: "tavily-bridge",
      tokenEnv: "TAVILY_BRIDGE_MCP_TOKEN"
    });
  });

  it("saves and reports a safe prefix without exposing the secret", async () => {
    const store = new TeamMcpSettingsStore(await userDataRoot(), { createToken: () => "tok" });
    const token = "mcp_deadbeefcafe.0123456789abcdef0123456789abcdef";
    const status = await store.saveToken(token);
    expect(status.configured).toBe(true);
    expect(status.tokenPrefix).toMatch(/^mcp_deadbeefcafe/);
    expect(JSON.stringify(status)).not.toContain("0123456789abcdef");
    expect(await store.readTokenForRuntime()).toBe(token);
    expect(await readFile(store.tokenPath, "utf8")).toContain("mcp_deadbeefcafe");
  });

  it("rejects invalid tokens and clears stored values", async () => {
    const store = new TeamMcpSettingsStore(await userDataRoot(), { createToken: () => "tok" });
    await expect(store.saveToken("tvly-official-key")).rejects.toThrow(/格式无效/);
    await store.saveToken("mcp_deadbeefcafe.0123456789abcdef0123456789abcdef");
    const cleared = await store.clearToken();
    expect(cleared.configured).toBe(false);
    expect(await store.readTokenForRuntime()).toBeUndefined();
  });

  it("reveals the full token only through the explicit reveal path", async () => {
    const store = new TeamMcpSettingsStore(await userDataRoot(), { createToken: () => "tok" });
    const token = "mcp_deadbeefcafe.0123456789abcdef0123456789abcdef";
    await store.saveToken(token);
    const status = await store.status();
    expect(status.tokenPrefix).toMatch(/^mcp_deadbeefcafe/);
    expect(JSON.stringify(status)).not.toContain("0123456789abcdef");
    await expect(store.revealToken()).resolves.toEqual({ status: "revealed", token });
    await store.clearToken();
    await expect(store.revealToken()).resolves.toEqual({ status: "missing" });
  });
});

describe("normalizeClientToken", () => {
  it("accepts only mcp client tokens", () => {
    expect(normalizeClientToken(" mcp_deadbeefcafe.0123456789abcdef0123456789abcdef "))
      .toBe("mcp_deadbeefcafe.0123456789abcdef0123456789abcdef");
    expect(normalizeClientToken("tvly-x")).toBeUndefined();
    expect(normalizeClientToken("mcp_onlyprefix")).toBeUndefined();
    expect(normalizeClientToken("mcp_ab.cd")).toBeUndefined();
  });

  it("builds a display prefix", () => {
    expect(safeTokenPrefix("mcp_ea63244d757b.secret")).toBe("mcp_ea63244d757b…");
  });
});

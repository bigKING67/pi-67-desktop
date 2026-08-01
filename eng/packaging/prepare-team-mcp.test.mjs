import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareTeamMcpToken } from "./prepare-team-mcp.mjs";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("prepareTeamMcpToken", () => {
  it("copies a valid client token into the destination without rewriting format", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-team-mcp-"));
    tempDirs.push(root);
    const source = join(root, "source.token");
    const destination = join(root, "out", "tavily-bridge.token");
    await writeFile(source, "mcp_deadbeefcafe.0123456789abcdef0123456789abcdef\n", "utf8");
    const result = await prepareTeamMcpToken({ source, destination });
    expect(result.destination).toBe(destination);
    expect(result.prefix).toMatch(/^mcp_deadbeefcafe/);
    const body = await readFile(destination, "utf8");
    expect(body.trim()).toBe("mcp_deadbeefcafe.0123456789abcdef0123456789abcdef");
  });

  it("rejects invalid token format", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-team-mcp-bad-"));
    tempDirs.push(root);
    const source = join(root, "source.token");
    const destination = join(root, "out", "tavily-bridge.token");
    await writeFile(source, "not-a-client-token\n", "utf8");
    await expect(prepareTeamMcpToken({ source, destination })).rejects.toThrow(/invalid client-token format/i);
  });
});

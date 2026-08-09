import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeRetiredTeamMcpToken } from "./retired-team-mcp-token.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("retired Team MCP token cleanup", () => {
  it("removes only the former Desktop-owned token path", async () => {
    const root = await temporaryRoot();
    const directory = join(root, "team-mcp");
    await mkdir(directory);
    await writeFile(join(directory, "keep.txt"), "keep", "utf8");
    await writeFile(join(directory, "tavily-bridge.token"), "legacy-secret", "utf8");

    await expect(removeRetiredTeamMcpToken(root)).resolves.toBe("removed");
    await expect(readFile(join(directory, "keep.txt"), "utf8")).resolves.toBe("keep");
    await expect(lstat(join(directory, "tavily-bridge.token"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not follow a symlinked legacy directory", async () => {
    const root = await temporaryRoot();
    const target = await temporaryRoot();
    await writeFile(join(target, "tavily-bridge.token"), "outside-secret", "utf8");
    await symlink(target, join(root, "team-mcp"), process.platform === "win32" ? "junction" : "dir");

    await expect(removeRetiredTeamMcpToken(root)).resolves.toBe("preserved-unsafe");
    await expect(readFile(join(target, "tavily-bridge.token"), "utf8")).resolves.toBe("outside-secret");
  });

  it("is idempotent when the legacy token is absent", async () => {
    const root = await temporaryRoot();
    await expect(removeRetiredTeamMcpToken(root)).resolves.toBe("missing");
  });

  it("reports a bounded failure instead of rejecting application startup", async () => {
    await expect(removeRetiredTeamMcpToken("\0invalid-user-data"))
      .resolves.toBe("failed");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-retired-team-mcp-token-"));
  roots.push(root);
  return root;
}

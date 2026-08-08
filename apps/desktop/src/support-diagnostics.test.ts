import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectPiConfigurationDiagnostics,
  MAX_DIAGNOSTIC_CONFIGURATION_BYTES
} from "./support-diagnostics.js";

describe("Pi configuration support diagnostics", () => {
  it("reports bounded configuration readability without exporting file contents or paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-support-diagnostics-"));
    const agentDirectory = join(root, "配置 Profile");
    await mkdir(agentDirectory);
    await writeFile(join(agentDirectory, "auth.json"), JSON.stringify({ openai: { apiKey: "secret-value" } }), "utf8");
    await writeFile(join(agentDirectory, "settings.json"), "{not-json", "utf8");
    await writeFile(
      join(agentDirectory, "models.json"),
      "x".repeat(MAX_DIAGNOSTIC_CONFIGURATION_BYTES + 1),
      "utf8"
    );

    const diagnostics = await collectPiConfigurationDiagnostics({
      agentDirectory,
      agentDirectorySource: "environment",
      environment: { PI_CODING_AGENT_DIR: join(root, "different-agent") }
    });

    expect(diagnostics.agentDirectory).toMatchObject({
      pathKind: process.platform === "win32" ? "drive" : "posix",
      source: "environment",
      state: "available",
      containsSpaces: true,
      containsNonAscii: true,
      currentEnvironmentMatchesAuthority: false
    });
    expect(diagnostics.agentDirectory.pathHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(diagnostics.files).toEqual([
      expect.objectContaining({ file: "auth.json", state: "valid-json" }),
      expect.objectContaining({ file: "settings.json", state: "invalid-json" }),
      expect.objectContaining({ file: "models.json", state: "oversized" })
    ]);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain(agentDirectory);
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("apiKey");
  });

  it.skipIf(process.platform === "win32")("does not follow an Agent Directory symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-support-diagnostics-link-"));
    const target = join(root, "target");
    const agentDirectory = join(root, "agent");
    await mkdir(target);
    await writeFile(join(target, "auth.json"), "{}", "utf8");
    await symlink(target, agentDirectory, "dir");

    await expect(collectPiConfigurationDiagnostics({
      agentDirectory,
      agentDirectorySource: "default",
      environment: { PI_CODING_AGENT_DIR: agentDirectory }
    })).resolves.toMatchObject({
      agentDirectory: {
        state: "symlink",
        currentEnvironmentMatchesAuthority: true
      },
      files: [
        { file: "auth.json", state: "directory-unavailable" },
        { file: "settings.json", state: "directory-unavailable" },
        { file: "models.json", state: "directory-unavailable" }
      ]
    });
  });

  it("classifies bounded path shapes without exposing the path", async () => {
    const root = parse(process.cwd()).root;
    const candidates = [
      [join(root, "s".repeat(20)), "short"],
      [join(root, "m".repeat(100)), "medium"],
      [join(root, "l".repeat(200)), "long"],
      [join(root, "x".repeat(250)), "extended"]
    ] as const;

    for (const [agentDirectory, expected] of candidates) {
      const diagnostics = await collectPiConfigurationDiagnostics({
        agentDirectory,
        agentDirectorySource: "environment",
        environment: { PI_CODING_AGENT_DIR: agentDirectory }
      });
      expect(diagnostics.agentDirectory.lengthClass).toBe(expected);
      expect(JSON.stringify(diagnostics)).not.toContain(agentDirectory);
    }
  });
});

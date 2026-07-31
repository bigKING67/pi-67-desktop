import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { publicToolchainStatus, resolveDesktopToolchain } from "./desktop-toolchain.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Desktop private toolchain resolver", () => {
  it("accepts only contained files for the current native target", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-toolchain-"));
    roots.push(root);
    for (const path of ["node/bin", "npm/bin", "git/bin", "git/libexec/git-core"]) {
      await mkdir(join(root, path), { recursive: true });
    }
    for (const path of [
      "node/bin/node",
      "npm/bin/npm-cli.js",
      "git/bin/git",
      "git/libexec/git-core/git-remote-https"
    ]) await writeFile(join(root, path), "fixture");
    await writeFile(join(root, "manifest.json"), JSON.stringify({
      schema: "pi67.desktop-toolchain.v1",
      platform: "darwin",
      architecture: "arm64",
      versions: { node: "24.18.0", npm: "12.0.1", git: "2.53.0" },
      paths: {
        node: "node/bin/node",
        npmCli: "npm/bin/npm-cli.js",
        git: "git/bin/git",
        gitExecPath: "git/libexec/git-core"
      }
    }));

    const toolchain = resolveDesktopToolchain(root, true, "darwin", "arm64");
    expect(toolchain).toMatchObject({ ready: true, nodeVersion: "24.18.0", npmVersion: "12.0.1", gitVersion: "2.53.0" });
    expect(publicToolchainStatus(toolchain)).not.toHaveProperty("root");
    expect(publicToolchainStatus(toolchain)).not.toHaveProperty("nodeExecutable");
    expect(publicToolchainStatus(toolchain)).not.toHaveProperty("gitExecPath");
  });

  it("fails closed when a manifest path escapes the resource root", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-toolchain-"));
    roots.push(root);
    await writeFile(join(root, "manifest.json"), JSON.stringify({
      schema: "pi67.desktop-toolchain.v1",
      platform: "darwin",
      architecture: "arm64",
      versions: { node: "24.18.0", npm: "12.0.1", git: "2.53.0" },
      paths: {
        node: "../node",
        npmCli: "npm/bin/npm-cli.js",
        git: "git/bin/git",
        gitExecPath: "git/libexec/git-core"
      }
    }));
    expect(resolveDesktopToolchain(root, true, "darwin", "arm64")).toMatchObject({ ready: false });
  });
});

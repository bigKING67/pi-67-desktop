import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { finalizeTestInstallation, assertStandalonePython, includePythonRuntimePath, installTeamWorkerBootstrap, parseNativePreparationArguments, runtimeTreeIdentity } from "./prepare-openviking-native.mjs";
import { applyPrivateRuntimePatch, normalizePrivateRuntimeLaunchers, relocatePythonLauncher } from "./openviking-runtime-patches.mts";

describe("native OpenViking preparation boundary", () => {
  it("reclaims only successful disposable runtime copies and preserves evidence and failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-retention-"));
    try {
      await mkdir(join(root, "runtime"));
      await writeFile(join(root, "runtime/python"), "synthetic");
      await writeFile(join(root, "assembly-receipt.json"), "evidence");
      const receipt = { nativeProbe: "FAILED", testInstallation: { installationRoot: root } };
      await finalizeTestInstallation(receipt);
      expect(await readFile(join(root, "runtime/python"), "utf8")).toBe("synthetic");
      receipt.nativeProbe = "PASS";
      await finalizeTestInstallation(receipt, true);
      expect(await readFile(join(root, "runtime/python"), "utf8")).toBe("synthetic");
      await finalizeTestInstallation(receipt);
      expect(await readdir(root)).toEqual(["assembly-receipt.json"]);
      expect(receipt.testInstallation.runtimeRetention).toBe("REMOVED_AFTER_SUCCESS");
      await expect(finalizeTestInstallation(receipt)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("allows explicit retention for diagnosis", () => {
    expect(parseNativePreparationArguments(["/python", "--keep-test-installation"]).keepTestInstallation).toBe(true);
  });
  it("normalizes independent staging paths to identical launcher and RECORD bytes", async () => {
    const outputs = [];
    for (const header of ["shell", "direct"]) {
      const temporary = await mkdtemp(join(tmpdir(), "new-money launcher-"));
      try {
        const root = await realpath(temporary);
        const packages = join(root, "lib/python3.12/site-packages");
        await mkdir(join(packages, "bin"), { recursive: true });
        await mkdir(join(packages, "fixture-1.0.dist-info"));
        const python = join(root, "bin/python3.12");
        const source = (header === "shell" ? `#!/bin/sh\n'''exec' '${python}' "$0" "$@"\n' '''\n` : `#!${python}\n`) + "print('synthetic')\n";
        const script = join(packages, "bin/tool");
        const record = join(packages, "fixture-1.0.dist-info/RECORD");
        await writeFile(script, source, { mode: 0o755 });
        await writeFile(record, `bin/tool,sha256=${createHash("sha256").update(source).digest("base64url")},${Buffer.byteLength(source)}\nfixture-1.0.dist-info/RECORD,,\n`);
        expect(await normalizePrivateRuntimeLaunchers(root)).toEqual({ revision: "relative-python-launchers-v1", count: 1 });
        const content = await readFile(script, "utf8");
        expect(content).not.toContain(root);
        const metadata = await readFile(record, "utf8");
        expect(metadata).toContain(`bin/tool,sha256=${createHash("sha256").update(content).digest("base64url")},${Buffer.byteLength(content)}\n`);
        outputs.push([content, metadata]);
        await expect(normalizePrivateRuntimeLaunchers(root)).rejects.toThrow("Expected generated Python launchers");
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
    expect(outputs[0]).toEqual(outputs[1]);
  });

  it("rejects damaged RECORD bytes without rewriting the launcher", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "new-money-record-guard-"));
    try {
      const root = await realpath(temporary);
      const packages = join(root, "lib/python3.12/site-packages");
      await mkdir(join(packages, "bin"), { recursive: true });
      await mkdir(join(packages, "fixture-1.0.dist-info"));
      const script = join(packages, "bin/tool");
      const source = `#!${root}/bin/python3.12\nprint('synthetic')\n`;
      await writeFile(script, source);
      await writeFile(join(packages, "fixture-1.0.dist-info/RECORD"), "bin/tool,sha256=invalid,0\n");
      await expect(normalizePrivateRuntimeLaunchers(root)).rejects.toThrow("does not match source bytes");
      expect(await readFile(script, "utf8")).toBe(source);
      expect(() => relocatePythonLauncher("unexpected", "/python")).toThrow("Unrecognized");
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
  it("keeps team defaults and requires an explicit private/offline mode without conflicting flags", () => {
    expect(parseNativePreparationArguments(["/python"])).toEqual({ python: "/python", purpose: "team-index-v1", offline: false, keepTestInstallation: false });
    expect(parseNativePreparationArguments(["/python", "--offline", "--private-lazy-litellm-v1"]))
      .toEqual({ python: "/python", purpose: "private-lazy-litellm-v1", offline: true, keepTestInstallation: false });
    expect(parseNativePreparationArguments(["/python", "--team-query-v1"]).purpose).toBe("team-query-v1");
    expect(parseNativePreparationArguments(["/python", "--private-query-coalescing-v1"]).purpose).toBe("private-query-coalescing-v1");
    for (const flags of [["--unknown"], ["--offline", "--offline"], ["--team-query-v1", "--private-lazy-litellm-v1"],
      ["--private-query-coalescing-v1", "--private-lazy-litellm-v1"], ["--private-query-coalescing-v1", "--team-query-v1"]]) {
      expect(() => parseNativePreparationArguments(["/python", ...flags])).toThrow("at most one purpose");
    }
  });

  it("refuses to overwrite a patch receipt before touching the staging tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "new-money-patch-guard-"));
    try {
      const canonical = await realpath(root);
      await writeFile(join(root, "newmoney-runtime-patches.json"), "existing");
      await expect(applyPrivateRuntimePatch(canonical)).rejects.toThrow("receipt already exists");
      expect(await readdir(root)).toEqual(["newmoney-runtime-patches.json"]);
      expect(await readFile(join(root, "newmoney-runtime-patches.json"), "utf8")).toBe("existing");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("stages only the query bootstrap in its own revision and refuses unknown purposes", async () => {
    const root = await mkdtemp(join(tmpdir(), "new-money-query-bootstrap-"));
    try {
      await expect(installTeamWorkerBootstrap(root, "other")).rejects.toThrow(/purpose/u);
      expect(await readdir(root)).toEqual([]);
      await installTeamWorkerBootstrap(root, "team-query-v1");
      expect(await readdir(join(root, "newmoney-team"))).toEqual(["query"]);
      const target = join(root, "newmoney-team/query/v1");
      expect(await readdir(target)).toEqual(["team_query_worker.py"]);
      const source = await readFile(join(target, "team_query_worker.py"));
      expect(source).toEqual(await readFile(new URL("openviking-runtime/team_query_worker.py", import.meta.url)));
      await expect(installTeamWorkerBootstrap(root, "team-query-v1")).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(join(target, "team_query_worker.py"))).toEqual(source);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("adds only the versioned production team bootstrap before tree measurement and never overwrites it", async () => {
    const root = await mkdtemp(join(tmpdir(), "new-money-team-bootstrap-"));
    try {
      const before = await runtimeTreeIdentity(root);
      await installTeamWorkerBootstrap(root);
      const target = join(root, "newmoney-team/v1");
      expect((await readdir(target)).sort()).toEqual(["team_index_worker.py", "team_model_channel.py", "team_model_transport.py"]);
      const script = await readFile(join(target, "team_index_worker.py"));
      expect((await runtimeTreeIdentity(root)).sha256).not.toBe(before.sha256);
      await expect(installTeamWorkerBootstrap(root)).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(join(target, "team_index_worker.py"))).toEqual(script);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("admits only the explicit tested standalone interpreter target", () => {
    const identity = { version: "3.12.10", prefix: "/python", basePrefix: "/python", machine: "arm64" };
    expect(() => assertStandalonePython(identity, "darwin", "arm64")).not.toThrow();
    for (const changed of [{ prefix: "/venv" }, { version: "3.13.0" }, { machine: "x86_64" }]) {
      expect(() => assertStandalonePython({ ...identity, ...changed }, "darwin", "arm64")).toThrow();
    }
    expect(() => assertStandalonePython(identity, "win32", "x64")).toThrow();
  });

  it("does not adopt source interpreter installed packages or bytecode", () => {
    expect(includePythonRuntimePath("lib/python3.12/ssl.py")).toBe(true);
    expect(includePythonRuntimePath("lib/python3.12/site-packages/user.py")).toBe(false);
    expect(includePythonRuntimePath("lib\\python3.12\\site-packages\\user.py")).toBe(false);
    expect(includePythonRuntimePath("lib/python3.12/__pycache__/ssl.pyc")).toBe(false);
  });

  it.skipIf(process.platform === "win32")("binds file content, names and relative links without accepting external links", async () => {
    const root = await mkdtemp(join(tmpdir(), "new-money-runtime-identity-"));
    try {
      await mkdir(join(root, "bin"));
      await writeFile(join(root, "bin/python3.12"), "synthetic");
      await symlink("python3.12", join(root, "bin/python"));
      const first = await runtimeTreeIdentity(root);
      expect(first.files).toBe(1);
      expect((await runtimeTreeIdentity(root)).sha256).toBe(first.sha256);
      await writeFile(join(root, "bin/python3.12"), "modified");
      expect((await runtimeTreeIdentity(root)).sha256).not.toBe(first.sha256);
      await symlink(tmpdir(), join(root, "external"));
      await expect(runtimeTreeIdentity(root)).rejects.toThrow(/escapes/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

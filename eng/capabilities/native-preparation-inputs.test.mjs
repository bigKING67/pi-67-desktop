import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { nativePreparationKey } from "./native-preparation-inputs.mjs";
import { includePythonRuntimePath } from "./prepare-openviking-native.mjs";
import { inspectNativeArtifacts, runNativeArtifact } from "./native-artifact-store.mjs";

it("binds interpreter, bootstrap, lock and verifier bytes while excluding adopted Python packages", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "native-input-key-")));
  try {
    for (const path of ["python/bin", "python/lib/site-packages", "eng/capabilities", "apps/desktop/src", "packages/protocol/src"]) {
      await mkdir(join(root, path), { recursive: true });
    }
    await writeFile(join(root, "python/bin/python"), "interpreter");
    const options = { pythonRoot: join(root, "python"), repositoryRoot: root, purpose: "private", keepTestInstallation: false,
      includePythonPath: includePythonRuntimePath };
    const first = await nativePreparationKey(options);
    await writeFile(join(root, "python/lib/site-packages/user"), "unrelated packages");
    expect(await nativePreparationKey(options)).toBe(first);
    expect(await nativePreparationKey({ ...options, purpose: "team" })).not.toBe(first);
    expect(await nativePreparationKey({ ...options, keepTestInstallation: true })).not.toBe(first);
    let previous = first;
    for (const path of ["python/bin/python", "eng/capabilities/requirements.txt", "eng/capabilities/worker.py", "apps/desktop/src/verifier.ts"]) {
      await writeFile(join(root, path), "changed");
      const next = await nativePreparationKey(options);
      expect(next).not.toBe(previous); previous = next;
    }
    await symlink(root, join(root, "python/external"));
    await expect(nativePreparationKey(options)).rejects.toThrow("escapes");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("reuses an owned payload after a documentation edit and rotates it only after real input upgrades", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "native-input-lifecycle-")));
  try {
    for (const path of ["python/bin", "eng/capabilities", "apps/desktop/src", "packages/protocol/src"]) {
      await mkdir(join(root, path), { recursive: true });
    }
    await writeFile(join(root, "python/bin/python"), "interpreter");
    const parent = join(root, "artifacts/native");
    const options = { pythonRoot: join(root, "python"), repositoryRoot: root, purpose: "private", keepTestInstallation: false,
      includePythonPath: includePythonRuntimePath };
    const build = vi.fn(async path => {
      await mkdir(join(path, "runtime"));
      await writeFile(join(path, "runtime/payload"), "verified runtime");
      await writeFile(join(path, "receipt.json"), "preserved evidence");
      return { path };
    });
    const generate = async () => runNativeArtifact({ parent, kind: "preparation", purpose: "private",
      key: await nativePreparationKey(options), build, report: () => {}, probeInUse: async () => false,
      validate: async path => { expect(await readFile(join(path, "runtime/payload"), "utf8")).toBe("verified runtime"); } });
    const first = await generate();
    await writeFile(join(root, "eng/capabilities/README.md"), "documentation update");
    expect(await generate()).toMatchObject({ path: first.path, artifactReuse: "VERIFIED_EXISTING" });
    expect(build).toHaveBeenCalledOnce();
    for (const version of ["upgraded once", "upgraded twice"]) {
      await writeFile(join(root, "eng/capabilities/requirements.txt"), version);
      expect(await generate()).toMatchObject({ artifactReuse: "CREATED" });
    }
    expect(build).toHaveBeenCalledTimes(3);
    expect(await inspectNativeArtifacts(parent)).toHaveLength(2);
    await expect(readFile(join(first.path, "runtime/payload"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(first.path, "receipt.json"), "utf8")).toBe("preserved evidence");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("reuses native inputs across documentation, unit-test and generated Python-cache edits", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "native-input-maintenance-")));
  try {
    for (const path of ["python/bin", "eng/capabilities/openviking-runtime/__pycache__", "apps/desktop/src", "packages/protocol/src"]) {
      await mkdir(join(root, path), { recursive: true });
    }
    await writeFile(join(root, "python/bin/python"), "interpreter");
    const options = { pythonRoot: join(root, "python"), repositoryRoot: root, purpose: "private", keepTestInstallation: false,
      includePythonPath: includePythonRuntimePath };
    const first = await nativePreparationKey(options);
    for (const path of ["eng/capabilities/README.md", "eng/capabilities/worker.test.mjs", "apps/desktop/src/service.native.test.ts",
      "packages/protocol/src/schema.test.ts", "eng/capabilities/.DS_Store", "eng/capabilities/openviking-runtime/__pycache__/worker.cpython-312.pyc"]) {
      await writeFile(join(root, path), "maintenance-only change");
      expect(await nativePreparationKey(options), path).toBe(first);
    }
    // Production probes/patches/locks and even unknown files remain inputs.
    for (const path of ["eng/capabilities/probe-openviking-native.mjs", "eng/capabilities/openviking-runtime-patches.mts",
      "eng/capabilities/requirements.txt", "packages/protocol/src/schema.ts", "eng/capabilities/unclassified-input.txt"]) {
      await writeFile(join(root, path), "changed runtime input");
      expect(await nativePreparationKey(options), path).not.toBe(first);
      await rm(join(root, path));
      expect(await nativePreparationKey(options), path).toBe(first);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

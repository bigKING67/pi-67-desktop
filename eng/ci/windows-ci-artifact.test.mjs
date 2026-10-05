import { mkdtemp, mkdir, writeFile, readFile, cp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWindowsCiArtifact, restoreWindowsCiArtifact } from "./windows-ci-artifact.mjs";

const context = { sourceSha: "a".repeat(40), runId: "123", buildAttempt: "1" };
const version = "0.1.0-alpha.44";
let directory;
let producer;
let consumer;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pi67-ci-transport-"));
  producer = join(directory, "producer");
  consumer = join(directory, "consumer");
  await mkdir(join(producer, "artifacts/release/win-unpacked/resources"), { recursive: true });
  await writeFile(join(producer, "artifacts/release/win-unpacked/New Money.exe"), "synthetic executable");
  await writeFile(join(producer, "artifacts/release/win-unpacked/resources/app.asar"), "synthetic application");
  await writeFile(join(producer, `artifacts/release/New-Money-${version}-win-x64.exe`), "synthetic installer");
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function transfer(kind = "runtime") {
  const result = await createWindowsCiArtifact({ root: producer, kind, version, context });
  await cp(join(producer, `artifacts/ci/windows-${kind}`), join(consumer, `artifacts/ci/windows-${kind}`), { recursive: true });
  return { root: consumer, kind, version, context, identitySha256: result.identitySha256 };
}

it.each(["runtime", "installer"])("restores exact %s bytes from an original build attempt", async kind => {
  const options = await transfer(kind);
  const identity = await restoreWindowsCiArtifact(options);
  expect(identity.buildAttempt).toBe("1"); // Retry consumers must use the producer output, not their new attempt.
  for (const file of identity.files) {
    expect(await readFile(join(consumer, "artifacts/release", file.path)))
      .toEqual(await readFile(join(producer, "artifacts/release", file.path)));
  }
});

it.each([
  { sourceSha: "b".repeat(40) }, { runId: "124" }, { buildAttempt: "2" }
])("rejects a mismatched source/run/build attempt before extraction: %j", async patch => {
  const options = await transfer();
  const execute = vi.fn();
  await expect(restoreWindowsCiArtifact({ ...options, context: { ...context, ...patch }, execute })).rejects.toThrow("scope mismatch");
  expect(execute).not.toHaveBeenCalled();
});

it("rejects a substituted identity even when the archive itself is unchanged", async () => {
  const options = await transfer();
  await writeFile(join(consumer, "artifacts/ci/windows-runtime/identity.json"), "{}");
  const execute = vi.fn();
  await expect(restoreWindowsCiArtifact({ ...options, execute })).rejects.toThrow("producer output");
  expect(execute).not.toHaveBeenCalled();
});

it("rejects a different version or transport kind before extraction", async () => {
  const options = await transfer();
  const execute = vi.fn();
  await expect(restoreWindowsCiArtifact({ ...options, version: "0.1.0-alpha.45", execute })).rejects.toThrow("scope mismatch");
  await cp(join(consumer, "artifacts/ci/windows-runtime"), join(consumer, "artifacts/ci/windows-installer"), { recursive: true });
  await expect(restoreWindowsCiArtifact({ ...options, kind: "installer", execute })).rejects.toThrow("scope mismatch");
  expect(execute).not.toHaveBeenCalled();
});

it("rejects corrupted archive bytes before extraction", async () => {
  const options = await transfer();
  await writeFile(join(consumer, "artifacts/ci/windows-runtime/payload.tar"), "corrupted");
  const execute = vi.fn();
  await expect(restoreWindowsCiArtifact({ ...options, execute })).rejects.toThrow("byte identity mismatch");
  expect(execute).not.toHaveBeenCalled();
});

it("does not overwrite an existing release tree", async () => {
  const options = await transfer();
  await mkdir(join(consumer, "artifacts/release"), { recursive: true });
  const existing = join(consumer, "artifacts/release/existing.txt");
  await writeFile(existing, "preserve");
  const execute = vi.fn();
  await expect(restoreWindowsCiArtifact({ ...options, execute })).rejects.toThrow("not empty");
  expect(execute).not.toHaveBeenCalled();
  expect(await readFile(existing, "utf8")).toBe("preserve");
});

it("rejects extracted content that differs from the recorded executable", async () => {
  const options = await transfer();
  const execute = vi.fn(async () => {
    await cp(join(producer, "artifacts/release/win-unpacked"), join(consumer, "artifacts/release/win-unpacked"), { recursive: true });
    await writeFile(join(consumer, "artifacts/release/win-unpacked/New Money.exe"), "different executable");
  });
  await expect(restoreWindowsCiArtifact({ ...options, execute })).rejects.toThrow("byte identity mismatch");
});

it("preserves archive-command failure rather than reporting a transport identity", async () => {
  const failure = new Error("tar failed");
  await expect(createWindowsCiArtifact({ root: producer, kind: "runtime", version, context,
    execute: vi.fn().mockRejectedValue(failure) })).rejects.toBe(failure);
});

it.skipIf(process.platform === "win32")("refuses source links before creating an archive", async () => {
  await symlink(join(producer, "artifacts/release/win-unpacked/New Money.exe"), join(producer, "artifacts/release/win-unpacked/link"));
  const execute = vi.fn();
  await expect(createWindowsCiArtifact({ root: producer, kind: "runtime", version, context, execute })).rejects.toThrow("link or special file");
  expect(execute).not.toHaveBeenCalled();
});

it.each(["../runtime", "unknown"])("rejects arbitrary transport scope %s", async kind => {
  await expect(createWindowsCiArtifact({ root: producer, kind, version, context })).rejects.toThrow("kind or version");
});

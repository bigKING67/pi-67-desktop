import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalJsonBytes,
  probeWindowsCandidateBaseline,
  readWindowsCandidateBaselineCatalog,
  restoreWindowsCandidateBaseline,
  validateCatalogRecord
} from "./windows-candidate-baseline.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("reviewed Windows candidate baseline catalog", () => {
  it("accepts the tracked catalog and rejects hash drift", async () => {
    const catalog = await readWindowsCandidateBaselineCatalog();
    expect(catalog.records).toHaveLength(1);
    const drifted = structuredClone(catalog.records[0]);
    drifted.manualTestReceipt.attestation.actor = "changed";
    expect(() => validateCatalogRecord(drifted)).toThrow("manual test receipt hash mismatch");
  });

  it("rejects duplicate catalog identities", async () => {
    const tracked = JSON.parse(await readFile(new URL("./windows-candidate-baselines.json", import.meta.url), "utf8"));
    tracked.records.push(structuredClone(tracked.records[0]));
    const directory = await temporaryDirectory();
    const path = join(directory, "catalog.json");
    await writeFile(path, JSON.stringify(tracked), "utf8");
    await expect(readWindowsCandidateBaselineCatalog(path)).rejects.toThrow("duplicate record");
  });
});

describe("immutable Windows candidate baseline recovery", () => {
  it("probes and atomically restores an exact hash-verified installer", async () => {
    const fixture = createFixture();
    const directory = await temporaryDirectory();
    const outputDirectory = join(directory, "release");
    const fetchImpl = responseFactory(fixture.installer, fixture.url);

    await expect(probeWindowsCandidateBaseline(fixture.record, fetchImpl)).resolves.toMatchObject({
      bytes: fixture.installer.length,
      sha256: fixture.sha256,
      url: fixture.url
    });
    const result = await restoreWindowsCandidateBaseline({
      catalog: { records: [fixture.record] },
      expected: fixture.expected,
      fetchImpl,
      outputDirectory
    });
    expect(result.installerPath).toBe(join(outputDirectory, fixture.fileName));
    expect(await readFile(result.installerPath)).toEqual(fixture.installer);
    expect(fetchImpl.mock.calls.map((call) => call[1])).toEqual([
      { method: "HEAD", redirect: "manual" },
      { method: "GET", redirect: "manual" }
    ]);
  });

  it.each([
    ["redirect", { redirected: true }, "redirected"],
    ["length", { contentLength: "1" }, "content length mismatch"],
    ["hash", { body: Buffer.from("wrong-baseline") }, "SHA-256 mismatch"]
  ])("rejects %s drift and removes staging output", async (_name, override, message) => {
    const fixture = createFixture();
    const directory = await temporaryDirectory();
    const outputDirectory = join(directory, "release");
    const fetchImpl = responseFactory(fixture.installer, fixture.url, override);
    await expect(restoreWindowsCandidateBaseline({
      catalog: { records: [fixture.record] },
      expected: fixture.expected,
      fetchImpl,
      outputDirectory
    })).rejects.toThrow(message);
    expect(await readdir(directory)).toEqual([]);
  });
});

function createFixture() {
  const version = "0.1.0-alpha.2";
  const installer = Buffer.from("exact-baseline");
  const sha256 = createHash("sha256").update(installer).digest("hex");
  const fileName = `New-Money-${version}-win-x64-unsigned-preview.exe`;
  const candidateIdentity = {
    schema: "pi67.windows-preview-candidate.v1",
    channel: "unsigned-preview-candidate",
    signed: false,
    repository: "owner/repo",
    workflow: { name: "Windows candidate", runId: "42", runAttempt: "1" },
    source: { policy: "main", commit: "a".repeat(40) },
    application: {
      product: "Pi-67 Desktop",
      version,
      platform: "win32",
      architecture: "x64",
      runtime: "@earendil-works/pi-coding-agent@0.81.1"
    },
    installer: { fileName: `New-Money-${version}-win-x64.exe`, byteLength: installer.length, sha256 },
    packagedExecutable: {
      fileName: "win-unpacked/New Money.exe",
      byteLength: 20,
      sha256: "d".repeat(64)
    }
  };
  const candidateIdentitySha256 = hashCanonical(candidateIdentity);
  const manualTestReceipt = {
    schema: "pi67.windows-preview-manual-test.v2",
    status: "passed",
    evidenceLevel: "manual-windows-x64-test-confirmed",
    repository: "owner/repo",
    source: { commit: candidateIdentity.source.commit },
    candidate: {
      identitySha256: candidateIdentitySha256,
      runId: "42",
      runAttempt: "1",
      certificationRunAttempt: "1",
      installerSha256: sha256,
      packagedExecutableSha256: candidateIdentity.packagedExecutable.sha256
    },
    attestation: { actor: "tester", channel: "operator-confirmed" }
  };
  const unsignedPreviewManifest = {
    schemaVersion: 1,
    product: "Pi-67 Desktop",
    version,
    channel: "unsigned-preview",
    signed: false,
    runtime: candidateIdentity.application.runtime,
    files: [
      { name: fileName, bytes: installer.length, sha256, target: "windows-x64" },
      {
        name: `New-Money-${version}-mac-arm64-unsigned-preview.dmg`,
        bytes: 1,
        sha256: "1".repeat(64),
        target: "macos-arm64"
      },
      {
        name: `New-Money-${version}-mac-arm64-unsigned-preview.zip`,
        bytes: 1,
        sha256: "2".repeat(64),
        target: "macos-arm64"
      }
    ]
  };
  const record = validateCatalogRecord({
    candidateIdentitySha256,
    manualTestReceiptSha256: hashCanonical(manualTestReceipt),
    unsignedPreviewManifestSha256: hashCanonical(unsignedPreviewManifest),
    publishedWindowsFileName: fileName,
    candidateIdentity,
    manualTestReceipt,
    unsignedPreviewManifest
  });
  return {
    expected: {
      repository: candidateIdentity.repository,
      sourceCommit: candidateIdentity.source.commit,
      runId: candidateIdentity.workflow.runId,
      runAttempt: candidateIdentity.workflow.runAttempt,
      candidateIdentitySha256,
      publishedWindowsFileName: fileName
    },
    fileName,
    installer,
    record,
    sha256,
    url: `https://updates.52671314.xyz/${fileName}`
  };
}

function hashCanonical(value) {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

function responseFactory(expectedBody, url, override = {}) {
  return vi.fn(async (_input, init) => {
    const body = override.body ?? expectedBody;
    const response = new Response(init.method === "HEAD" ? null : body, {
      status: 200,
      headers: { "content-length": override.contentLength ?? String(expectedBody.length) }
    });
    Object.defineProperties(response, {
      redirected: { value: override.redirected ?? false },
      url: { value: override.url ?? url }
    });
    return response;
  });
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "pi67-windows-baseline-"));
  temporaryDirectories.push(directory);
  return directory;
}

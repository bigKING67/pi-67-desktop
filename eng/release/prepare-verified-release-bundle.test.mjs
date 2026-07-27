import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareVerifiedReleaseBundle,
  verifiedReleaseBundleFiles,
  verifiedReleaseSourceFiles
} from "./prepare-verified-release-bundle.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { force: true, recursive: true })
  )));
});

describe("verified release bundle", () => {
  it("copies only the exact stable release allowlist plus native evidence", async () => {
    const root = await temporaryDirectory();
    const releaseRoot = join(root, "release-source");
    const certificationRoot = join(root, "certification-source");
    const providerCertificationRoot = join(root, "provider-certification-source");
    const outputRoot = join(root, "verified-bundle");
    await Promise.all([
      mkdir(releaseRoot, { recursive: true }),
      mkdir(join(certificationRoot, "scale-125"), { recursive: true }),
      mkdir(providerCertificationRoot, { recursive: true })
    ]);
    for (const name of verifiedReleaseSourceFiles("1.2.3")) {
      await writeFile(join(releaseRoot, name), name);
    }
    await writeFile(join(releaseRoot, "latest.yml"), "must-not-copy");
    const summary = Buffer.from("{}");
    const providerSummary = Buffer.from("{\"status\":\"passed\"}");
    const scales = {};
    await writeFile(join(certificationRoot, "summary.json"), summary);
    await writeFile(join(providerCertificationRoot, "summary.json"), providerSummary);
    for (const label of ["125", "150", "200"]) {
      const scaleDirectory = join(certificationRoot, `scale-${label}`);
      const receipt = Buffer.from("{}");
      const screenshot = Buffer.from(`screenshot-${label}`);
      await mkdir(scaleDirectory, { recursive: true });
      await writeFile(join(scaleDirectory, "receipt.json"), receipt);
      await writeFile(join(scaleDirectory, "workspace.png"), screenshot);
      scales[label] = {
        receiptSha256: sha256(receipt),
        screenshotSha256: sha256(screenshot)
      };
    }
    await writeFile(join(releaseRoot, "windows-native-release-gate.json"), JSON.stringify({
      schema: "pi67.windows-native-release-gate.v1",
      status: "passed",
      certification: { summarySha256: sha256(summary), scales }
    }));
    await writeFile(join(releaseRoot, "provider-long-turn-release-gate.json"), JSON.stringify({
      schema: "pi67.provider-long-turn-release-gate.v1",
      status: "passed",
      evidence: { summarySha256: sha256(providerSummary) }
    }));

    await prepareVerifiedReleaseBundle({
      certificationRoot,
      outputRoot,
      providerCertificationRoot,
      releaseRoot,
      version: "1.2.3"
    });

    expect((await readdir(join(outputRoot, "release"))).sort())
      .toEqual(verifiedReleaseBundleFiles("1.2.3").sort());
    expect(await readdir(join(outputRoot, "certification/windows-native")))
      .toEqual(expect.arrayContaining(["scale-125", "summary.json"]));
    expect(await readdir(join(outputRoot, "certification/provider-long-turn")))
      .toEqual(["summary.json"]);

    await writeFile(join(certificationRoot, "scale-150/receipt.json"), "changed-after-gate");
    await expect(prepareVerifiedReleaseBundle({
      certificationRoot,
      outputRoot: join(root, "drifted-bundle"),
      providerCertificationRoot,
      releaseRoot,
      version: "1.2.3"
    })).rejects.toThrow("changed after release gate verification");
  });
});

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "pi67-verified-release-bundle-"));
  temporaryDirectories.push(path);
  return path;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

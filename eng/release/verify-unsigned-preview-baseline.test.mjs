import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyUnsignedPreviewBaseline } from "./verify-unsigned-preview-baseline.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("unsigned preview Windows upgrade baseline", () => {
  it("verifies the exact Windows artifact against the release manifest and checksum file", async () => {
    const fixture = await createFixture();
    await expect(verifyUnsignedPreviewBaseline(fixture.directory, "v0.1.0-alpha.2"))
      .resolves.toMatchObject({ version: "0.1.0-alpha.2" });
  });

  it("rejects a modified installer and a mismatched tag", async () => {
    const fixture = await createFixture();
    await writeFile(fixture.installerPath, "modified", "utf8");
    await expect(verifyUnsignedPreviewBaseline(fixture.directory, "v0.1.0-alpha.2"))
      .rejects.toThrow("size mismatch");
    await expect(verifyUnsignedPreviewBaseline(fixture.directory, "v0.1.0-alpha.3"))
      .rejects.toThrow("manifest version mismatch");
  });
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "pi67-preview-baseline-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  const version = "0.1.0-alpha.2";
  const installerName = `Pi-67-Desktop-${version}-win-x64-unsigned-preview.exe`;
  const installerPath = join(directory, installerName);
  const installer = Buffer.from("unsigned preview fixture");
  const sha256 = createHash("sha256").update(installer).digest("hex");
  await writeFile(installerPath, installer);
  const files = [
    { name: installerName, bytes: installer.length, sha256, target: "windows-x64" },
    {
      name: `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.dmg`,
      bytes: 1,
      sha256: "1".repeat(64),
      target: "macos-arm64"
    },
    {
      name: `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.zip`,
      bytes: 1,
      sha256: "2".repeat(64),
      target: "macos-arm64"
    }
  ];
  await writeFile(join(directory, "unsigned-preview-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    product: "Pi-67 Desktop",
    version,
    channel: "unsigned-preview",
    signed: false,
    runtime: "@earendil-works/pi-coding-agent@0.81.1",
    files
  }), "utf8");
  await writeFile(join(directory, "SHA256SUMS.txt"), `${sha256}  ${installerName}\n`, "utf8");
  return { directory, installerPath };
}

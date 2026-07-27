import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { valid as validSemver } from "semver";
import { validateUnsignedPreviewManifest } from "./unsigned-preview-artifacts.mjs";

const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;

export async function verifyUnsignedPreviewBaseline(directory, tag) {
  const version = typeof tag === "string" && tag.startsWith("v") ? validSemver(tag.slice(1)) : null;
  if (!version) throw new Error(`Invalid unsigned preview baseline tag: ${String(tag)}.`);

  const manifest = JSON.parse(await readBoundedText(join(directory, "unsigned-preview-manifest.json")));
  const runtimeMatch = /^@earendil-works\/pi-coding-agent@(.+)$/u.exec(manifest?.runtime);
  const failures = runtimeMatch
    ? validateUnsignedPreviewManifest(manifest, version, runtimeMatch[1])
    : ["invalid runtime identity"];
  const expectedName = `Pi-67-Desktop-${version}-win-x64-unsigned-preview.exe`;
  const windowsEntries = Array.isArray(manifest?.files)
    ? manifest.files.filter((entry) => entry?.target === "windows-x64")
    : [];
  if (windowsEntries.length !== 1 || windowsEntries[0]?.name !== expectedName) {
    failures.push("manifest must contain exactly one expected Windows x64 artifact");
  }

  const installerPath = join(directory, expectedName);
  const installer = await stat(installerPath).catch(() => null);
  if (!installer?.isFile() || installer.size < 1 || installer.size > MAX_INSTALLER_BYTES) {
    failures.push("Windows baseline installer is missing or outside the size boundary");
  } else if (windowsEntries.length === 1) {
    const sha256 = await hashFile(installerPath);
    const entry = windowsEntries[0];
    if (entry.bytes !== installer.size) failures.push("Windows baseline installer size mismatch");
    if (entry.sha256 !== sha256) failures.push("Windows baseline installer SHA-256 mismatch");
    const checksumLines = (await readBoundedText(join(directory, "SHA256SUMS.txt")))
      .split(/\r?\n/u)
      .filter(Boolean);
    if (!checksumLines.includes(`${sha256}  ${expectedName}`)) {
      failures.push("Windows baseline checksum entry is missing");
    }
  }

  if (failures.length > 0) {
    throw new Error(`Unsigned preview baseline verification failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  }
  return { installerPath: resolve(installerPath), version };
}

async function readBoundedText(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_METADATA_BYTES) {
    throw new Error(`${path} exceeds the unsigned preview metadata boundary.`);
  }
  return readFile(path, "utf8");
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyUnsignedPreviewBaseline(process.argv[2], process.argv[3]);
  console.log(`Verified unsigned preview Windows upgrade baseline ${result.version}.`);
  if (process.env.GITHUB_ENV) {
    if (result.installerPath.includes("\r") || result.installerPath.includes("\n")) {
      throw new Error("Unsigned preview baseline path cannot be written to GITHUB_ENV.");
    }
    await appendFile(process.env.GITHUB_ENV, `PI67_WINDOWS_BASELINE_INSTALLER=${result.installerPath}\n`, "utf8");
  }
}

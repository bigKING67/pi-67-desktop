import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const defaultReleaseDirectory = join(root, "artifacts/release");

export function unsignedPreviewArtifactSpecs(version) {
  return [
    {
      source: `Pi-67-Desktop-${version}-win-x64.exe`,
      name: `Pi-67-Desktop-${version}-win-x64-unsigned-preview.exe`,
      target: "windows-x64"
    },
    {
      source: `Pi-67-Desktop-${version}-mac-arm64.dmg`,
      name: `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.dmg`,
      target: "macos-arm64"
    },
    {
      source: `Pi-67-Desktop-${version}-mac-arm64.zip`,
      name: `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.zip`,
      target: "macos-arm64"
    }
  ];
}

export async function prepareUnsignedPreview(releaseDirectory, version, runtimeVersion) {
  const files = await Promise.all(unsignedPreviewArtifactSpecs(version).map(async (spec) => {
    const source = join(releaseDirectory, spec.source);
    const destination = join(releaseDirectory, spec.name);
    await rename(source, destination);
    return {
      name: spec.name,
      bytes: (await stat(destination)).size,
      sha256: await hashFile(destination),
      target: spec.target
    };
  }));

  const manifest = {
    schemaVersion: 1,
    product: "Pi-67 Desktop",
    version,
    channel: "unsigned-preview",
    signed: false,
    runtime: `@earendil-works/pi-coding-agent@${runtimeVersion}`,
    files
  };
  await writeFile(join(releaseDirectory, "unsigned-preview-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(
    join(releaseDirectory, "SHA256SUMS.txt"),
    `${files.map((file) => `${file.sha256}  ${file.name}`).join("\n")}\n`,
    "utf8"
  );
  console.log(`Prepared unsigned preview manifest for ${files.length} artifact(s).`);
}

export async function verifyUnsignedPreview(releaseDirectory, version, runtimeVersion) {
  const manifest = JSON.parse(await readFile(join(releaseDirectory, "unsigned-preview-manifest.json"), "utf8"));
  const failures = validateUnsignedPreviewManifest(manifest, version, runtimeVersion);
  const checksums = await readFile(join(releaseDirectory, "SHA256SUMS.txt"), "utf8");

  const fileFailures = await Promise.all((Array.isArray(manifest.files) ? manifest.files : []).map(async (entry) => {
    if (typeof entry?.name !== "string") return [];
    const path = join(releaseDirectory, entry.name);
    try {
      const entryFailures = [];
      const bytes = (await stat(path)).size;
      const sha256 = await hashFile(path);
      if (bytes !== entry.bytes) entryFailures.push(`${entry.name}: size mismatch`);
      if (sha256 !== entry.sha256) entryFailures.push(`${entry.name}: SHA-256 mismatch`);
      if (!checksums.includes(`${sha256}  ${entry.name}\n`)) entryFailures.push(`${entry.name}: checksum entry missing`);
      return entryFailures;
    } catch {
      return [`${entry.name}: file is missing`];
    }
  }));
  failures.push(...fileFailures.flat());

  if (failures.length > 0) {
    throw new Error(`Unsigned preview verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
  console.log(`Verified ${manifest.files.length} unsigned preview artifact(s) for ${version}.`);
}

export function validateUnsignedPreviewManifest(manifest, version, runtimeVersion) {
  const failures = [];
  const specs = unsignedPreviewArtifactSpecs(version);
  const entries = Array.isArray(manifest?.files) ? manifest.files : [];
  if (manifest?.schemaVersion !== 1 || manifest?.product !== "Pi-67 Desktop") failures.push("invalid manifest identity");
  if (manifest?.version !== version) failures.push("manifest version mismatch");
  if (manifest?.channel !== "unsigned-preview" || manifest?.signed !== false) failures.push("manifest channel must be unsigned-preview");
  if (manifest?.runtime !== `@earendil-works/pi-coding-agent@${runtimeVersion}`) failures.push("runtime version mismatch");
  if (entries.length !== specs.length) failures.push("manifest must contain exactly three artifacts");

  const expected = new Map(specs.map((spec) => [spec.name, spec.target]));
  const names = new Set();
  for (const entry of entries) {
    if (typeof entry?.name !== "string" || !expected.has(entry.name)) {
      failures.push(`unsupported artifact name: ${String(entry?.name)}`);
      continue;
    }
    if (names.has(entry.name)) failures.push(`duplicate artifact name: ${entry.name}`);
    names.add(entry.name);
    if (entry.target !== expected.get(entry.name)) failures.push(`${entry.name}: target mismatch`);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 1) failures.push(`${entry.name}: invalid size`);
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) failures.push(`${entry.name}: invalid SHA-256`);
  }
  for (const name of expected.keys()) if (!names.has(name)) failures.push(`manifest is missing ${name}`);
  return failures;
}

async function packageReleaseContract() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const runtimeVersion = packageJson.devDependencies?.["@earendil-works/pi-coding-agent"]
    ?? JSON.parse(await readFile(join(root, "packages/pi-runtime/package.json"), "utf8")).dependencies["@earendil-works/pi-coding-agent"];
  return { version: packageJson.version, runtimeVersion };
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const action = process.argv[2];
  const { version, runtimeVersion } = await packageReleaseContract();
  if (action === "prepare") await prepareUnsignedPreview(defaultReleaseDirectory, version, runtimeVersion);
  else if (action === "verify") await verifyUnsignedPreview(defaultReleaseDirectory, version, runtimeVersion);
  else throw new Error("Usage: node eng/release/unsigned-preview-artifacts.mjs <prepare|verify>");
}

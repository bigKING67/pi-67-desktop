import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const releaseDirectory = join(root, "artifacts/release");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const expected = [
  `Pi-67-Desktop-${version}-win-x64.exe`,
  `Pi-67-Desktop-${version}-mac-arm64.dmg`,
  `Pi-67-Desktop-${version}-mac-arm64.zip`
];
const available = new Set(await readdir(releaseDirectory));
const missing = expected.filter((name) => !available.has(name));
if (missing.length > 0) throw new Error(`Incomplete Pi-67 Desktop ${version} release; missing: ${missing.join(", ")}`);

const files = [];
for (const name of expected) {
  const path = join(releaseDirectory, name);
  files.push({
    name,
    bytes: (await stat(path)).size,
    sha256: await hashFile(path),
    target: name.includes("win-x64") ? "windows-x64" : "macos-arm64"
  });
}

const manifest = {
  schemaVersion: 1,
  product: "Pi-67 Desktop",
  version,
  runtime: "@earendil-works/pi-coding-agent@0.81.1",
  files
};
await writeFile(join(releaseDirectory, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote release manifest for ${files.length} artifact(s).`);

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

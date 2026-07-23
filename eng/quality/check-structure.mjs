import { access, readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const failures = [];
const bannedDirectories = new Set(["utils", "helpers", "common", "misc", "temp", "new", "final", "legacy"]);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "artifacts", "coverage", "test-results", "playwright-report"]);
const requiredPaths = [
  "AGENTS.md",
  "PRODUCT.md",
  "DESIGN.md",
  "DESIGN.dark.md",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "docs/adr/0001-electron-sdk-runtime.md",
  "docs/architecture/processes-and-protocol.md",
  "docs/compatibility/pi-sdk.md",
  "docs/provenance/peak-code-reference.md",
  "docs/release/signing.md",
  "docs/testing/performance.md"
];
const expectedFonts = new Set([
  "MapleMono-Bold.ttf.woff2",
  "MapleMono-BoldItalic.ttf.woff2",
  "MapleMono-Italic.ttf.woff2",
  "MapleMono-Regular.ttf.woff2"
]);
const expectedIconSize = 1024;

for (const path of requiredPaths) {
  try {
    await access(join(root, path));
  } catch {
    failures.push(`missing required path: ${path}`);
  }
}

const files = await walk(root);
for (const file of files) {
  const path = toRepoPath(file);
  const extension = extname(file).toLowerCase();
  if ([".cs", ".csproj", ".sln", ".slnx", ".wxs", ".wixproj"].includes(extension)) {
    failures.push(`stale native implementation file: ${path}`);
  }
  if ([".ts", ".tsx", ".mjs", ".cjs", ".css"].includes(extension)) {
    const lineCount = (await readFile(file, "utf8")).split("\n").length;
    const limit = extension === ".css" ? 1_100 : 460;
    if (lineCount > limit) failures.push(`${path} has ${lineCount} lines; limit is ${limit}`);
  }
}

const fontsDirectory = join(root, "apps/renderer/src/assets/fonts");
try {
  const fonts = new Set((await readdir(fontsDirectory)).filter((name) => name.endsWith(".woff2")));
  for (const name of expectedFonts) if (!fonts.has(name)) failures.push(`missing Maple Mono asset: ${name}`);
  for (const name of fonts) if (!expectedFonts.has(name)) failures.push(`unexpected font asset: ${name}`);
} catch {
  failures.push("font asset directory is missing");
}

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (packageJson.packageManager !== "pnpm@11.16.0") failures.push("packageManager must be exactly pnpm@11.16.0");
for (const section of ["dependencies", "devDependencies"]) {
  for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
    if (typeof version !== "string" || (!version.startsWith("workspace:") && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version))) {
      failures.push(`${section}.${name} must use an exact version, found ${String(version)}`);
    }
  }
}

for (const staleLock of ["package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"]) {
  try {
    await access(join(root, staleLock));
    failures.push(`stale package-manager lockfile: ${staleLock}`);
  } catch {}
}

const builder = await readFile(join(root, "electron-builder.yml"), "utf8");
if (!/^icon:\s*eng\/packaging\/icon\.png$/mu.test(builder)) failures.push("shared application icon is not configured");
for (const required of ["--x64", "--arm64"]) {
  if (builder.includes(required)) failures.push(`electron-builder config must use structured arch values, not ${required}`);
}
if (!/win:[\s\S]*?arch:\s*\n\s*- x64/u.test(builder)) failures.push("Windows x64 packaging target is missing");
if (!/mac:[\s\S]*?arch:\s*\n\s*- arm64/u.test(builder)) failures.push("macOS arm64 packaging target is missing");
if (/\b(?:linux|ia32|universal)\b/iu.test(builder)) failures.push("unsupported packaging target found in electron-builder.yml");

for (const path of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
  const workflow = await readFile(join(root, path), "utf8");
  const preparesPnpmBeforeCachedNode = /pnpm\/action-setup@v6[\s\S]*?version:\s*11\.16\.0[\s\S]*?actions\/setup-node@v5[\s\S]*?cache:\s*pnpm/u;
  if (!preparesPnpmBeforeCachedNode.test(workflow)) {
    failures.push(`${path} must install pinned pnpm before setup-node enables the pnpm cache`);
  }
}

const icon = await readFile(join(root, "eng/packaging/icon.png"));
const iconWidth = icon.readUInt32BE(16);
const iconHeight = icon.readUInt32BE(20);
if (icon.toString("ascii", 1, 4) !== "PNG" || iconWidth !== expectedIconSize || iconHeight !== expectedIconSize) {
  failures.push(`application icon must be a ${expectedIconSize}x${expectedIconSize} PNG`);
}

if (failures.length > 0) {
  console.error(`Structure check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Structure check passed: ${files.length} governed files, exact dependencies, supported targets only.`);

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (bannedDirectories.has(entry.name)) failures.push(`banned generic directory: ${toRepoPath(path)}`);
      output.push(...await walk(path));
    } else {
      output.push(path);
    }
  }
  return output;
}

function toRepoPath(path) {
  return relative(root, path).split(sep).join("/");
}

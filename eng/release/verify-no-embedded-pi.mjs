import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootArgument = process.argv.indexOf("--root");
const root = path.resolve(rootArgument >= 0 ? process.argv[rootArgument + 1] : "artifacts/app/win-x64");
const deniedFragments = [
  "node_modules/@earendil-works/pi-coding-agent",
  "node_modules\\@earendil-works\\pi-coding-agent",
  "electron.exe",
  "app.asar",
  "chrome_elf.dll",
  "webview2loader.dll",
];
const required = [
  "Pi67.Desktop.App.exe",
  "Bridge/index.mjs",
  "Extensions/pi67-desktop-safety/index.mjs",
  "Manifests/compatibility.json",
  "Manifests/bootstrap-inventory.json",
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const files = await walk(root);
const relative = files.map((file) => path.relative(root, file).split(path.sep).join("/"));
const normalized = relative.map((file) => file.toLowerCase());
const violations = [];
for (let index = 0; index < relative.length; index += 1) {
  for (const fragment of deniedFragments) {
    if (normalized[index].includes(fragment.toLowerCase())) violations.push(relative[index]);
  }
}
for (const marker of required) {
  if (!relative.includes(marker)) violations.push(`missing:${marker}`);
}
if (violations.length > 0) {
  throw new Error(`Release isolation audit failed:\n${[...new Set(violations)].join("\n")}`);
}

let bytes = 0;
for (const file of files) bytes += (await stat(file)).size;
process.stdout.write(`${JSON.stringify({ ok: true, root, fileCount: files.length, bytes })}\n`);

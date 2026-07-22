import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootIndex = process.argv.indexOf("--root");
const outputIndex = process.argv.indexOf("--output");
const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : "artifacts/release");
const output = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : path.join(root, "SHA256SUMS"));

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(absolute));
    else if (entry.isFile() && absolute !== output) result.push(absolute);
  }
  return result;
}

const lines = [];
for (const file of await walk(root)) {
  const digest = createHash("sha256").update(await readFile(file)).digest("hex");
  lines.push(`${digest}  ${path.relative(root, file).split(path.sep).join("/")}`);
}
lines.sort();
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${lines.join("\n")}\n`);
process.stdout.write(`${output}\n`);

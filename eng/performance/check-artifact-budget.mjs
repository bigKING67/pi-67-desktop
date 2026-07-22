import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootIndex = process.argv.indexOf("--root");
const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : "artifacts/app/win-x64");
const budgets = { totalBytes: 120 * 1024 * 1024, fileCount: 500, bridgeBytes: 2 * 1024 * 1024, safetyBytes: 1024 * 1024 };

async function measure(directory) {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await measure(absolute);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      bytes += (await stat(absolute)).size;
      files += 1;
    }
  }
  return { bytes, files };
}

const total = await measure(root);
const bridge = await measure(path.join(root, "Bridge"));
const safety = await measure(path.join(root, "Extensions", "pi67-desktop-safety"));
const failures = [];
if (total.bytes > budgets.totalBytes) failures.push(`payload bytes ${total.bytes} > ${budgets.totalBytes}`);
if (total.files > budgets.fileCount) failures.push(`file count ${total.files} > ${budgets.fileCount}`);
if (bridge.bytes > budgets.bridgeBytes) failures.push(`bridge bytes ${bridge.bytes} > ${budgets.bridgeBytes}`);
if (safety.bytes > budgets.safetyBytes) failures.push(`safety bytes ${safety.bytes} > ${budgets.safetyBytes}`);
if (failures.length > 0) throw new Error(`Artifact performance budget failed: ${failures.join("; ")}`);
process.stdout.write(`${JSON.stringify({ ok: true, total, bridge, safety, budgets })}\n`);

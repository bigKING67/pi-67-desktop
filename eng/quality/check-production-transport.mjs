import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scanRoots = [
  "apps/desktop/src",
  "apps/agent-host/src",
  "apps/renderer/src",
  "packages/pi-runtime/src",
  "packages/protocol/src"
];
const files = (await Promise.all(scanRoots.map((path) => collect(join(root, path))))).flat();
files.push(join(root, "apps/renderer/index.html"));

const forbidden = [
  ["WebSocket API", /\bWebSocket\b/u],
  ["local HTTP server", /\bcreateServer\s*\(/u],
  ["listening socket", /\.listen\s*\(/u],
  ["WebSocket URL", /\bwss?:\/\//u],
  ["localhost production URL", /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)/u]
];
const failures = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) failures.push(`${toRepoPath(file)} contains ${label}`);
  }
}

const main = await readFile(join(root, "apps/desktop/src/main.ts"), "utf8");
for (const required of ["app://pi67/index.html", "MessageChannelMain", "utilityProcess.fork", "contextIsolation: true", "sandbox: true"]) {
  if (!main.includes(required)) failures.push(`desktop transport invariant is missing: ${required}`);
}

if (failures.length > 0) {
  console.error(`Production transport check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Production transport check passed: ${files.length} files, app:// assets, MessagePort IPC, no local listener/WebSocket.`);

async function collect(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collect(path));
    else if ([".ts", ".tsx", ".html"].includes(extname(entry.name))) output.push(path);
  }
  return output;
}

function toRepoPath(path) {
  return relative(root, path).split(sep).join("/");
}

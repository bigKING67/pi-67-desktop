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
  ["WebSocket URL", /\bwss?:\/\//u]
];
const localUrlPattern = /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)[^"'\s]*/gu;
const failures = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(source)) failures.push(`${toRepoPath(file)} contains ${label}`);
  }
  for (const match of source.matchAll(localUrlPattern)) {
    const isAllowedViteUrl = toRepoPath(file) === "apps/desktop/src/renderer-security.ts"
      && (match[0] === "http://127.0.0.1:5173/" || match[0] === "http://127.0.0.1:5173");
    if (!isAllowedViteUrl) failures.push(`${toRepoPath(file)} contains localhost production URL`);
  }
}

const main = await readFile(join(root, "apps/desktop/src/main.ts"), "utf8");
const agentHostSupervisor = await readFile(join(root, "apps/desktop/src/agent-host-supervisor.ts"), "utf8");
const agentHostPortHandoff = await readFile(join(root, "apps/desktop/src/agent-host-port-handoff.ts"), "utf8");
const mainWindow = await readFile(join(root, "apps/desktop/src/main-window.ts"), "utf8");
const rendererSecurity = await readFile(join(root, "apps/desktop/src/renderer-security.ts"), "utf8");
const desktopTransportInvariants = [
  ["MessageChannelMain", agentHostPortHandoff],
  ["webContents.postMessage", agentHostPortHandoff],
  ["input.host.postMessage", agentHostPortHandoff],
  ["utilityProcess.fork", agentHostSupervisor],
  ["contextIsolation: true", mainWindow],
  ["sandbox: true", mainWindow],
  ["resolveRendererUrl", main]
];
for (const [required, source] of desktopTransportInvariants) {
  if (!source.includes(required)) failures.push(`desktop transport invariant is missing: ${required}`);
}
if (!rendererSecurity.includes('PACKAGED_RENDERER_URL = "app://pi67/index.html"')) {
  failures.push("renderer security invariant is missing: packaged app://pi67/index.html");
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
    else if (
      [".ts", ".tsx", ".html"].includes(extname(entry.name))
      && !entry.name.includes(".test.")
      && !entry.name.includes(".spec.")
    ) output.push(path);
  }
  return output;
}

function toRepoPath(path) {
  return relative(root, path).split(sep).join("/");
}

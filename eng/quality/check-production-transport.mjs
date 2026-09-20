import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { productionTransportViolations } from "./production-transport-policy.mjs";

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

const failures = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  failures.push(...productionTransportViolations(toRepoPath(file), source));
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
console.log(`Production transport check passed: ${files.length} files, app:// assets, MessagePort IPC, no business listener/WebSocket; bounded native sidecar reservation.`);

async function collect(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collect(path));
    else if (
      [".ts", ".tsx", ".mts", ".cts", ".html"].includes(extname(entry.name))
      && !entry.name.includes(".test.")
      && !entry.name.includes(".spec.")
    ) output.push(path);
  }
  return output;
}

function toRepoPath(path) {
  return relative(root, path).split(sep).join("/");
}

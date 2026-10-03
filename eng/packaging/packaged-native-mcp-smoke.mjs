import { access, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const PACKAGED_NATIVE_MCP_TOOL = "mcp__packaged_native__echo";
const NATIVE_MCP_EXTENSION_PATH = "<inline:pi67-native-mcp>";
const POLL_INTERVAL_MS = 50;

// This is an isolated stdio server, deliberately without any network listener.
// Its child remains alive when the parent transport closes so the packaged smoke
// can observe the SDK's process-tree ownership during reload and shutdown.
const serverSource = String.raw`
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const [receiptPath, expectedNode] = process.argv.slice(2);
const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], { stdio: "ignore" });
const record = (event) => appendFileSync(receiptPath, JSON.stringify({ pid: process.pid, ...event }) + "\n");
record({ type: "start", childPid: child.pid, privateNode: process.execPath === expectedNode });
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const result = (id, value) => send({ id, result: value });
const echo = {
  name: "echo",
  description: "Packaged native MCP smoke echo.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false }
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    result(message.id, {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "pi67-packaged-native", version: "1" }
    });
  } else if (message.method === "tools/list") {
    result(message.id, { tools: [echo] });
  } else if (message.method === "tools/call") {
    record({ type: "call", name: message.params.name });
    result(message.id, { content: [{ type: "text", text: "PACKAGED_NATIVE_MCP_OK" }] });
  } else if (message.id !== undefined) {
    result(message.id, {});
  }
});
`;

export async function preparePackagedNativeMcpFixture({ agentDir, artifact }) {
  const privateNode = await resolvePackagedPrivateNode(artifact);
  const serverPath = join(agentDir, "packaged-native-mcp-server.mjs");
  const processReceiptPath = join(agentDir, "packaged-native-mcp-process.jsonl");
  const evidencePath = join(agentDir, "packaged-native-mcp-evidence.json");
  await Promise.all([
    writeFile(serverPath, serverSource, { encoding: "utf8", mode: 0o600 }),
    writeFile(processReceiptPath, "", { encoding: "utf8", mode: 0o600 }),
    writeFile(join(agentDir, "mcp.json"), `${JSON.stringify({ mcpServers: {
      packaged_native: {
        command: privateNode,
        args: [serverPath, processReceiptPath, privateNode],
        exposure: "direct",
        timeout: 10
      }
    } }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  ]);
  return { evidencePath, processReceiptPath };
}

export async function resolvePackagedPrivateNode(artifact) {
  const toolchainRoot = resolve(artifact.resourcesPath, "toolchain");
  const manifestPath = join(toolchainRoot, "manifest.json");
  let nodePath;
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    nodePath = manifest?.paths?.node;
  } catch {
    throw new Error("Packaged toolchain manifest is unreadable.");
  }
  if (typeof nodePath !== "string" || nodePath.length === 0 || isAbsolute(nodePath)) {
    throw new Error("Packaged toolchain manifest does not declare a relative Node executable.");
  }
  const nodeExecutable = resolve(toolchainRoot, nodePath);
  if (!isContained(toolchainRoot, nodeExecutable)) {
    throw new Error("Packaged toolchain Node executable escapes its toolchain root.");
  }
  await access(nodeExecutable);
  return nodeExecutable;
}

export async function assertPackagedNativeMcpCall({ evidencePath, processReceiptPath, timeoutMs = 15_000 }) {
  const deadline = Date.now() + timeoutMs;
  let evidence;
  let records = [];
  while (Date.now() <= deadline) {
    evidence = await readJson(evidencePath);
    records = await readJsonLines(processReceiptPath);
    if (evidence?.modelSelected === true && evidence?.resultObserved === true
      && records.filter((entry) => entry.type === "call").length === 1) break;
    await delay(POLL_INTERVAL_MS);
  }
  if (!evidence || evidence.discoveredTool !== PACKAGED_NATIVE_MCP_TOOL
    || evidence.source !== "inline" || evidence.sourcePath !== NATIVE_MCP_EXTENSION_PATH
    || evidence.sourceScope !== "temporary" || evidence.sourceOrigin !== "top-level"
    || evidence.legacyMcpProxyPresent !== false || evidence.toolCallObserved !== true
    || evidence.modelSelected !== true || evidence.resultObserved !== true || evidence.resultSucceeded !== true) {
    throw new Error(`Packaged native MCP did not produce the required discovered-tool receipt: ${JSON.stringify(evidence ?? null)}; starts=${records.filter((entry) => entry.type === "start").length}; calls=${records.filter((entry) => entry.type === "call").length}.`);
  }
  const starts = records.filter((entry) => entry.type === "start");
  const calls = records.filter((entry) => entry.type === "call");
  if (starts.length === 0 || !starts.every((entry) => entry.privateNode === true)
    || calls.length !== 1 || calls[0]?.name !== "echo") {
    throw new Error("Packaged native MCP stdio receipt did not prove one private-Node echo call.");
  }
  return { calls: calls.length, servers: starts.length, tool: PACKAGED_NATIVE_MCP_TOOL };
}

export async function assertPackagedNativeMcpProcessesStopped(processReceiptPath) {
  const records = await readJsonLines(processReceiptPath);
  const pids = records.filter((entry) => entry.type === "start")
    .flatMap((entry) => [entry.pid, entry.childPid])
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  if (pids.length === 0) throw new Error("Packaged native MCP created no owned process receipt.");
  if (pids.some(isProcessAlive)) throw new Error("Packaged native MCP left an owned stdio process after shutdown.");
}

export async function resetPackagedNativeMcpProcessReceipt(processReceiptPath) {
  await writeFile(processReceiptPath, "", { encoding: "utf8", mode: 0o600 });
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return undefined; }
}

async function readJsonLines(path) {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/u).filter(Boolean).slice(0, 128)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function isContained(root, candidate) {
  const path = relative(root, candidate);
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

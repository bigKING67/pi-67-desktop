import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PACKAGED_NATIVE_MCP_TOOL,
  assertPackagedNativeMcpCall,
  preparePackagedNativeMcpFixture,
  resolvePackagedPrivateNode
} from "./packaged-native-mcp-smoke.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("packaged native MCP smoke fixture", () => {
  it("uses only the packaged toolchain Node and writes an isolated direct stdio config", async () => {
    const root = await fixtureRoot();
    const agentDir = join(root, "agent");
    await mkdir(agentDir);
    const artifact = await packagedArtifact(root);

    const fixture = await preparePackagedNativeMcpFixture({ agentDir, artifact });
    const config = JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8"));
    const server = config.mcpServers.packaged_native;

    expect(server.command).toBe(await resolvePackagedPrivateNode(artifact));
    expect(server.exposure).toBe("direct");
    expect(server.args).toEqual([join(agentDir, "packaged-native-mcp-server.mjs"), fixture.processReceiptPath, server.command]);
    await expect(readFile(join(agentDir, "packaged-native-mcp-server.mjs"), "utf8"))
      .resolves.toContain("PACKAGED_NATIVE_MCP_OK");
  });

  it("rejects an absolute or escaping packaged Node manifest path", async () => {
    const root = await fixtureRoot();
    const manifestPath = join(root, "resources", "toolchain", "manifest.json");
    await writeFile(manifestPath, JSON.stringify({ paths: { node: "/outside/node" } }), "utf8");
    await expect(resolvePackagedPrivateNode({ resourcesPath: join(root, "resources") }))
      .rejects.toThrow("relative Node executable");

    await writeFile(manifestPath, JSON.stringify({ paths: { node: "../outside/node" } }), "utf8");
    await expect(resolvePackagedPrivateNode({ resourcesPath: join(root, "resources") }))
      .rejects.toThrow("escapes its toolchain root");
  });

  it("requires the native inline source, one model-selected result, and one private-Node stdio call", async () => {
    const root = await fixtureRoot();
    const evidencePath = join(root, "evidence.json");
    const processReceiptPath = join(root, "process.jsonl");
    await writeFile(evidencePath, JSON.stringify({
      discoveredTool: PACKAGED_NATIVE_MCP_TOOL,
      source: "inline",
      sourcePath: "<inline:pi67-native-mcp>",
      sourceScope: "temporary",
      sourceOrigin: "top-level",
      legacyMcpProxyPresent: false,
      toolCallObserved: true,
      modelSelected: true,
      resultObserved: true,
      resultSucceeded: true
    }), "utf8");
    await writeFile(processReceiptPath, [
      JSON.stringify({ type: "start", pid: 101, childPid: 102, privateNode: true }),
      JSON.stringify({ type: "call", name: "echo" })
    ].join("\n"), "utf8");

    await expect(assertPackagedNativeMcpCall({ evidencePath, processReceiptPath, timeoutMs: 1 }))
      .resolves.toEqual({ calls: 1, servers: 1, tool: PACKAGED_NATIVE_MCP_TOOL });
  });

  it("frames real JSON-RPC initialize and tools/list replies from the generated stdio server", async () => {
    const root = await fixtureRoot();
    const agentDir = join(root, "agent");
    await mkdir(agentDir);
    const fixture = await preparePackagedNativeMcpFixture({
      agentDir,
      artifact: await packagedArtifact(root)
    });
    const server = spawn(process.execPath, [
      join(agentDir, "packaged-native-mcp-server.mjs"),
      fixture.processReceiptPath,
      process.execPath
    ], { stdio: ["pipe", "pipe", "ignore"] });
    const replies = collectJsonRpcLines(server);
    try {
      server.stdin.write(JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" }
      }) + "\n");
      await expect(replies.next()).resolves.toMatchObject({ id: 1, result: {
        protocolVersion: "2025-06-18", serverInfo: { name: "pi67-packaged-native" }
      } });
      server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
      await expect(replies.next()).resolves.toMatchObject({ id: 2, result: {
        tools: [expect.objectContaining({ name: "echo" })]
      } });
    } finally {
      server.kill();
      await waitForChildExit(server);
      const records = (await readFile(fixture.processReceiptPath, "utf8")).split(/\r?\n/u).filter(Boolean)
        .map((line) => JSON.parse(line));
      for (const pid of records.flatMap((entry) => [entry.pid, entry.childPid])) {
        if (!Number.isSafeInteger(pid) || !processAlive(pid)) continue;
        process.kill(pid);
        await waitForProcessExit(pid);
      }
    }
  });
});

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "pi67-packaged-native-mcp-"));
  roots.push(root);
  await mkdir(join(root, "resources", "toolchain", "node", "bin"), { recursive: true });
  await writeFile(join(root, "resources", "toolchain", "node", "bin", "node"), "fixture", "utf8");
  await writeFile(join(root, "resources", "toolchain", "manifest.json"), JSON.stringify({
    paths: { node: "node/bin/node" }
  }), "utf8");
  return root;
}

async function packagedArtifact(root) {
  return { resourcesPath: join(root, "resources") };
}

function collectJsonRpcLines(child) {
  const pending = [];
  const waiters = [];
  let buffer = "";
  let failure;
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const value = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter(value); else pending.push(value);
    }
  });
  child.once("error", (error) => { failure = error; });
  return {
    next: () => {
      if (failure) return Promise.reject(failure);
      const next = pending.shift();
      if (next) return Promise.resolve(next);
      return new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for generated native MCP JSON-RPC reply.")), 2_000);
        waiters.push((value) => { clearTimeout(timeout); resolvePromise(value); });
      });
    }
  };
}

async function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, 2_000);
    child.once("exit", () => { clearTimeout(timeout); resolvePromise(); });
  });
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 2_000;
  while (Date.now() <= deadline) {
    if (!processAlive(pid)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error("Generated native MCP fixture process did not exit: " + pid);
}

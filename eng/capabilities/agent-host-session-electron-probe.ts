import assert from "node:assert/strict";
import { app, MessageChannelMain, utilityProcess } from "electron";
import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { resolveDesktopToolchain } from "../../apps/desktop/src/desktop-toolchain.js";
import type { EnterpriseCredentialSupervisor } from "../../apps/desktop/src/enterprise-credential-supervisor.js";
import { probeLiveHostSession } from "./agent-host-session-live-probe.js";
import {
  PROTOCOL_REVISION, PROTOCOL_VERSION, commandEnvelope, isHostWelcome, isResponseEnvelope,
  isAgentHostReadyMessage, isAgentHostShutdownCompleteMessage,
  type AgentCommandType, type CommandPayloads, type CommandResults, type ProtocolContext,
  type ResponseEnvelope, type TaskProtocolContext, type AgentHostShutdownCompleteMessage
} from "@pi67/protocol";

const directory = process.env.PI67_HOST_SESSION_PROBE_DIR, entry = process.env.PI67_HOST_SESSION_PROBE_ENTRY;
let stage = "environment";
if (!directory || !entry || !isAbsolute(directory) || !isAbsolute(entry)) app.exit(1);
else {
  app.setPath("userData", directory);
  void app.whenReady().then(probe).then(() => {
    console.log(process.env.PI67_NEWMONEY_LIVE_DIRECTORY
      ? "HOST_SESSION_LIVE_PASS: official Host device authorization, encrypted credential restart, private/team JSONL isolation and logout denial; isolated Main driver only"
      : "HOST_SESSION_ENTRY_PASS: official utility entry and Pi runtime, private JSONL creation/restart, signed-out cold/warm team denial without private mutation, graceful Host exits; isolated Main driver only");
    app.exit(0);
  }).catch(() => { console.error(`HOST_SESSION_FAILED: stage=${stage}`); app.exit(1); });
}

async function waitFor<T>(read: () => T | undefined, signal: AbortSignal): Promise<T> {
  while (true) { signal.throwIfAborted(); const value = read(); if (value !== undefined) return value; await delay(20, undefined, { signal }); }
}

async function startHost(root: string, epoch: number, credentials?: EnterpriseCredentialSupervisor) {
  const workspace = join(root, "workspace"), agentDir = join(root, "agent"), storageRoot = join(root, "storage");
  const toolchainRoot = process.env.PI67_HOST_SESSION_PROBE_TOOLCHAIN;
  assert.ok(toolchainRoot && isAbsolute(toolchainRoot));
  const toolchain = resolveDesktopToolchain(toolchainRoot, false); assert.ok(toolchain.ready);
  const child = utilityProcess.fork(entry!, [], { cwd: workspace, stdio: "pipe", serviceName: "New Money Host Session probe",
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", PI_TELEMETRY: "0", PI67_DESKTOP: "1", PI67_PACKAGED: "0",
      ...(process.env.NODE_EXTRA_CA_CERTS ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } : {}),
      PI_CODING_AGENT_DIR: agentDir, PI67_STORAGE_ROOT: storageRoot, PI67_CAPABILITY_PROBE_DIR: storageRoot,
      PI67_SESSION_CATALOG_DIR: join(storageRoot, "projections", "session-catalog"), PI67_MANAGED_LOCAL_MEMORY: "0",
      PI67_TOOLCHAIN_ROOT: toolchain.root, PI67_NODE_EXECUTABLE: toolchain.nodeExecutable!, PI67_NPM_CLI: toolchain.npmCli!,
      PI67_GIT_EXECUTABLE: toolchain.gitExecutable!, PI67_GIT_EXEC_PATH: toolchain.gitExecPath! } });
  let ready = false, startupRejected = false, exited = false, exitCode: number | undefined, shutdown: AgentHostShutdownCompleteMessage | undefined;
  let logBytes = 0;
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (data: Buffer) => {
    logBytes += data.byteLength; if (logBytes > 256 * 1024) child.kill();
  });
  child.once("exit", code => { exited = true; exitCode = code; });
  child.on("message", (value: unknown) => {
    if (isAgentHostReadyMessage(value)) { startupRejected = value.startup.status !== "ready"; ready = !startupRejected; }
    if (isAgentHostShutdownCompleteMessage(value)) shutdown = value;
    const operation = credentials?.operation(value);
    if (operation) void operation.then(result => { if (!exited) child.postMessage(result); }).catch(() => { startupRejected = true; child.kill(); });
  });
  const channel = new MessageChannelMain(), responses = new Map<string, ResponseEnvelope>();
  let welcomed = false;
  channel.port1.on("message", (event: { data: unknown }) => {
    if (isHostWelcome(event.data)) welcomed = true;
    if (isResponseEnvelope(event.data)) responses.set(event.data.requestId, event.data);
  });
  channel.port1.start();
  const close = async () => {
    if (!exited) child.postMessage({ type: "agent-host-shutdown", reason: "application-quit", deadlineMs: 5_000 });
    try {
      await waitFor(() => exited || undefined, AbortSignal.timeout(10_000));
      assert.equal(exitCode, 0); assert.equal(shutdown?.activeOperation, "none");
      assert.equal(shutdown?.queuedCommandsDropped, 0);
    } finally {
      channel.port1.close();
      if (!exited) { child.kill(); await waitFor(() => exited || undefined, AbortSignal.timeout(5_000)); }
    }
  };
  try {
    stage = "host-ready";
    await waitFor(() => { assert.ok(!exited && !startupRejected); return ready || undefined; }, AbortSignal.timeout(45_000));
    child.postMessage(credentials ? await credentials.bootstrapMessage() : { type: "enterprise-credential-bootstrap", storage: "available" });
    child.postMessage({ type: "attach-port", appInstanceId: "session-probe", hostInstanceId: `host-${epoch}`, hostEpoch: epoch }, [channel.port2]);
    channel.port1.postMessage({ kind: "hello", protocolVersion: PROTOCOL_VERSION, protocolRevision: PROTOCOL_REVISION,
      rendererInstanceId: `renderer-${epoch}`, appInstanceId: "session-probe", maxEnvelopeBytes: 2 * 1024 * 1024 });
    stage = "host-handshake";
    await waitFor(() => { assert.ok(!exited); return welcomed || undefined; }, AbortSignal.timeout(30_000));
    return { close, workspace, agentDir,
      async request<T extends AgentCommandType>(type: T, payload: CommandPayloads[T], context: ProtocolContext, denied: boolean | string = false): Promise<CommandResults[T] | undefined> {
        stage = type.toLowerCase();
        const command = commandEnvelope(type, payload, context, epoch);
        channel.port1.postMessage(command);
        const response = await waitFor(() => { assert.ok(!exited); return responses.get(command.requestId); }, AbortSignal.timeout(45_000));
        stage = "response-validation";
        responses.delete(command.requestId); assert.equal(response.type, type);
        if (denied) {
          assert.ok(!response.ok); assert.equal(response.error.code, "RUNTIME_NOT_READY");
          assert.equal(response.error.message, typeof denied === "string" ? denied : "Sign in to New Money first."); return undefined;
        }
        if (!response.ok) console.error(`HOST_SESSION_RESPONSE_FAILED: type=${type},code=${response.error.code}`);
        assert.ok(response.ok); return response.result as CommandResults[T];
      }
    };
  } catch (error) { await close(); throw error; }
}

export type SessionProbeHost = Awaited<ReturnType<typeof startHost>>;

async function jsonlFiles(path: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const files: string[] = [];
  for (const item of entries) {
    assert.ok(!item.isSymbolicLink());
    if (item.isDirectory()) files.push(...await jsonlFiles(join(path, item.name)));
    else if (item.name.endsWith(".jsonl")) files.push(join(path, item.name));
  }
  assert.ok(files.length <= 10); return files.sort();
}

async function probe() {
  const root = await realpath(directory!);
  await Promise.all([mkdir(join(root, "workspace"), { mode: 0o700 }), mkdir(join(root, "storage"), { mode: 0o700 })]);
  if (process.env.PI67_NEWMONEY_LIVE_DIRECTORY) {
    await probeLiveHostSession(root, process.env.PI67_NEWMONEY_LIVE_DIRECTORY, startHost, value => { stage = value; });
    return;
  }
  const workspaceContext = { scope: "workspace" as const, workspaceId: "session-workspace" };
  const task = (id: string): TaskProtocolContext => ({ scope: "task", workspaceId: workspaceContext.workspaceId, taskId: id, taskGeneration: 1 });
  const teamScope = { teamId: "00000000-0000-4000-8000-000000000001", projectId: "00000000-0000-4000-8000-000000000002" };
  let stored: { sessionId: string; sessionPath: string; bytes: Buffer } | undefined;
  for (const epoch of [1, 2]) {
    const host = await startHost(root, epoch);
    try {
      await host.request("workspace.register", { cwd: host.workspace, trust: "trusted", approvalMode: "guided" }, workspaceContext);
      if (epoch === 1) {
        await host.request("session.create", { creationId: "denied-cold", teamScope }, task("cold-team"), true);
        assert.equal((await jsonlFiles(host.agentDir)).length, 0);
        const created = await host.request("session.create", { creationId: "anonymous-private" }, task("private")); assert.ok(created);
        const context = { ...task("private"), sessionId: created.sessionId, sessionFileIdentity: created.sessionFileIdentity, sessionGeneration: created.sessionGeneration };
        const projection = await host.request("projection.resync", {}, context); assert.ok(projection);
        stage = "private-origin";
        assert.deepEqual(projection.snapshot.memoryOrigin, { kind: "private" });
        const resolved = await host.request("session.creation.resolve", { creationId: "anonymous-private" }, workspaceContext);
        assert.ok(resolved?.status === "materialized" && resolved.sessionId === created.sessionId);
        const sessionPath = await realpath(resolved.sessionPath); assert.ok(sessionPath.startsWith(`${root}${sep}`));
        stored = { sessionId: created.sessionId, sessionPath, bytes: await readFile(sessionPath) };
        const records = stored.bytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
        const provenance = records.filter(record => record.type === "custom" && record.customType === "pi67.memory-provenance.v1");
        assert.equal(provenance.length, 1);
        assert.deepEqual(provenance[0]!.data, { version: 1, kind: "private", originSessionId: created.sessionId });
        await host.request("session.create", { creationId: "denied-warm", teamScope }, context, true);
        assert.ok(stored.bytes.equals(await readFile(sessionPath)));
        assert.deepEqual(await jsonlFiles(host.agentDir), [sessionPath]);
        for (const creationId of ["denied-cold", "denied-warm"]) {
          assert.equal((await host.request("session.creation.resolve", { creationId }, workspaceContext))?.status, "missing");
        }
      } else {
        assert.ok(stored);
        const reopened = await host.request("runtime.initialize", { cwd: host.workspace, agentDir: host.agentDir,
          sessionPath: stored.sessionPath, trust: "trusted", approvalMode: "guided" }, task("restored")); assert.ok(reopened);
        assert.equal(reopened.sessionId, stored.sessionId);
        const projection = await host.request("projection.resync", {}, { ...task("restored"), sessionId: reopened.sessionId,
          sessionFileIdentity: reopened.sessionFileIdentity, sessionGeneration: reopened.sessionGeneration }); assert.ok(projection);
        stage = "restored-private-origin";
        assert.deepEqual(projection.snapshot.memoryOrigin, { kind: "private" });
        stage = "restored-jsonl";
        const restoredBytes = await readFile(stored.sessionPath);
        assert.ok(restoredBytes.subarray(0, stored.bytes.length).equals(stored.bytes));
        // Pi SDK initializes thinking metadata again when reopening a Session without messages.
        // Preserve the entire original JSONL prefix and permit only that exact metadata append.
        const appended = restoredBytes.subarray(stored.bytes.length).toString("utf8").trim().split("\n")
          .map(line => JSON.parse(line) as Record<string, unknown>);
        const original = stored.bytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
        assert.equal(appended.length, 1);
        assert.deepEqual(Object.keys(appended[0]!).sort(), ["id", "parentId", "thinkingLevel", "timestamp", "type"]);
        assert.equal(appended[0]!.type, "thinking_level_change");
        assert.equal(appended[0]!.thinkingLevel, original.filter(record => record.type === "thinking_level_change").at(-1)?.thinkingLevel);
        assert.equal(appended[0]!.parentId, original.at(-1)!.id);
        assert.deepEqual(await jsonlFiles(host.agentDir), [stored.sessionPath]);
      }
    } finally { const prior = stage; stage = "host-shutdown"; await host.close(); stage = prior; }
  }
}

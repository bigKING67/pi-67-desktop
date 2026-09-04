import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPackagedContextIsolationReceipt,
  assertPathContained,
  collectIsolatedSessionEvidence,
  PACKAGED_CONTEXT_ISOLATION_RECEIPT_SCHEMA,
  sha256,
  snapshotDirectoryMetadata,
  watchDirectoryMutationDigests
} from "./packaged-context-isolation-receipt.mjs";
import {
  cleanupPackagedTestDirectories,
  createPackagedTestDirectories,
  launchPackagedApplication,
  resolvePackagedArtifact
} from "./packaged-electron-fixture.mjs";
import { closeElectronApplicationWithinTimeout } from "./electron-shutdown-measurement.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const runId = randomUUID();
const accountId = `pi67-isolation-account-${runId}`;
const userId = `pi67-isolation-user-${runId}`;
const peerId = `pi67-isolation-peer-${runId}`;
const accessValue = `pi67-isolation-access-${randomUUID()}`;
const canonicalSessionRoot = join(homedir(), ".pi", "agent", "sessions");
const evidenceDirectory = process.env.PI67_ISOLATION_EVIDENCE_DIR?.trim()
  || join(repositoryRoot, "artifacts", "evidence", "packaged-context-isolation", runId);
const artifact = resolvePackagedArtifact();
const directories = await createPackagedTestDirectories("pi67-packaged-isolation-", "synthetic-workspace");
const providerObservationPath = join(directories.userDataDirectory, "provider-observations.jsonl");
const contextDiagnosticPath = join(directories.agentDir, "runtime", "context-recall-observations.ndjson");
const canonicalBefore = await snapshotDirectoryMetadata(canonicalSessionRoot);
if (!canonicalBefore.exists) {
  throw new Error("Canonical Pi Session root is absent; refusing to create or inspect it for an isolation receipt.");
}
const canonicalProbe = watchDirectoryMutationDigests(canonicalSessionRoot);
const openViking = await startSyntheticOpenViking({ accountId, accessValue, peerId, userId });
let application;
let runtimeWindow;
let isolatedSessions = [];
let modelContext = { memoryContextBlockCount: -1 };
let canonicalAfter = canonicalBefore;
let isolatedProfileRemoved = false;
let openVikingDoubleClosed = false;
let contextDiagnosticEvents = [];
let boundedUiState = "";
let runError;
let closeFailure;
try {
  await prepareIsolationProfile({
    ...directories,
    endpoint: openViking.endpoint,
    providerObservationPath
  });
  application = await launchPackagedApplication({
    agentDir: directories.agentDir,
    artifact,
    environment: {
      HOME: directories.userDataDirectory,
      USERPROFILE: directories.userDataDirectory,
      OPENVIKING_URL: openViking.endpoint,
      OPENVIKING_API_KEY: accessValue,
      OPENVIKING_ACCOUNT: accountId,
      OPENVIKING_USER: userId,
      OPENVIKING_PEER_ID: peerId,
      OPENVIKING_WORKSPACE_PEER: "0",
      PI67_CONTEXT_EVENT_LOG: contextDiagnosticPath
    },
    hideNativeWindow: true,
    isolateNativeWindow: true,
    offline: false,
    userDataDirectory: directories.userDataDirectory
  });
  const window = await application.firstWindow({ timeout: 60_000 });
  runtimeWindow = window;
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 30_000 });
  await application.evaluate(({ dialog }, workspace) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] });
  }, directories.workspace);
  await window.getByRole("button", { name: "选择工作区" }).click();
  await window.getByLabel("当前状态：Pi SDK 已就绪").waitFor({ state: "visible", timeout: 45_000 });
  await window.getByRole("textbox", { name: "给 Pi 发送消息" }).fill("Verify the isolated packaged Session and empty synthetic memory recall.");
  await window.getByRole("button", { name: "发送", exact: true }).click();
  await window.locator(
    '[data-testid="conversation-row"][aria-current="page"][data-conversation-id^="session:"]'
  ).waitFor({ state: "visible", timeout: 30_000 });
  await window.getByTestId("virtuoso-item-list")
    .getByText("Synthetic packaged isolation response.", { exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  await window.locator('[data-runtime-phase="ready"]').waitFor({ state: "visible", timeout: 30_000 });
  await waitFor(() => openViking.observations.some((entry) => entry.path.startsWith("/api/v1/search/")));
  await waitFor(() => openViking.observations.some((entry) => entry.path.includes("/messages")));
  modelContext = await readModelContext(providerObservationPath);
  isolatedSessions = await collectIsolatedSessionEvidence(directories.agentDir);
  await Promise.all([
    assertPathContained(directories.userDataDirectory, directories.agentDir),
    assertPathContained(directories.userDataDirectory, directories.workspace),
    ...isolatedSessions.map((session) => assertPathContained(
      directories.agentDir,
      join(directories.agentDir, session.relativePath)
    ))
  ]);
} catch (error) {
  runError = error;
  boundedUiState = await runtimeWindow?.locator("body").innerText().then((value) => value.slice(0, 4_000)).catch(() => "") ?? "";
} finally {
  if (application) {
    const close = await closeElectronApplicationWithinTimeout({ application, timeoutMs: 5_000 });
    if (close.timedOut || close.error || close.mainAliveAfterClose) {
      closeFailure = new Error(`Packaged isolation application did not close cleanly: ${JSON.stringify(close)}`);
    }
  }
  canonicalProbe.close();
  canonicalAfter = await snapshotDirectoryMetadata(canonicalSessionRoot);
  contextDiagnosticEvents = await readBoundedNdjson(contextDiagnosticPath);
  await openViking.close();
  openVikingDoubleClosed = await endpointUnavailable(openViking.endpoint);
  await cleanupPackagedTestDirectories(directories.userDataDirectory);
  isolatedProfileRemoved = !(await pathExists(directories.userDataDirectory));
}
if (runError) {
  const requestBoundaries = openViking.observations.slice(-50).map(({ method, path, identityMatched }) => ({
    method,
    path,
    identityMatched
  }));
  throw new Error(
    `Packaged isolation failed after bounded OpenViking requests=${JSON.stringify(requestBoundaries)} diagnostics=${JSON.stringify(contextDiagnosticEvents)} ui=${JSON.stringify(boundedUiState)}`,
    { cause: runError }
  );
}
if (closeFailure) throw closeFailure;

const artifactMetadata = await stat(artifact.executablePath);
const receipt = {
  schema: PACKAGED_CONTEXT_ISOLATION_RECEIPT_SCHEMA,
  status: "passed",
  evidenceLevel: "packaged-electron-runtime",
  observedAt: new Date().toISOString(),
  runId,
  host: { platform: process.platform, arch: process.arch },
  artifact: {
    executablePath: relative(repositoryRoot, artifact.executablePath),
    byteLength: artifactMetadata.size,
    sha256: await sha256File(artifact.executablePath)
  },
  isolation: {
    allPathsContained: true,
    agentDirectorySha256: sha256(directories.agentDir),
    userDataDirectorySha256: sha256(directories.userDataDirectory),
    workspaceSha256: sha256(directories.workspace)
  },
  canonicalSessionRoot: {
    pathSha256: sha256(canonicalSessionRoot),
    before: canonicalBefore,
    after: canonicalAfter,
    mutationEventCount: canonicalProbe.observations.length,
    mutationPathDigests: canonicalProbe.observations.map((entry) => entry.pathSha256)
  },
  isolatedSessions,
  openViking: {
    transport: "isolated-loopback-double",
    endpoint: openViking.endpoint,
    accountId,
    userId,
    peerId,
    requestCount: openViking.observations.length,
    healthObserved: openViking.observations.some((entry) => entry.path === "/health"),
    searchObserved: openViking.observations.some((entry) => entry.path.startsWith("/api/v1/search/")),
    messageWriteObserved: openViking.observations.some((entry) => entry.path.includes("/messages")),
    nonSyntheticIdentityCount: openViking.observations.filter((entry) => !entry.identityMatched).length,
    returnedRecallEntries: 0,
    requestBoundaries: openViking.observations.map(({ method, path, identityMatched }) => ({
      method,
      path,
      identityMatched
    }))
  },
  modelContext,
  cleanup: { isolatedProfileRemoved, openVikingDoubleClosed }
};
assertPackagedContextIsolationReceipt(receipt);
await mkdir(evidenceDirectory, { recursive: true });
const receiptPath = join(evidenceDirectory, "receipt.json");
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({
  status: receipt.status,
  receiptPath,
  isolatedSessionCount: isolatedSessions.length,
  canonicalMutationEventCount: canonicalProbe.observations.length,
  openVikingRequestCount: openViking.observations.length,
  returnedRecallEntries: 0,
  isolatedProfileRemoved,
  openVikingDoubleClosed
}));

async function prepareIsolationProfile({ agentDir, endpoint, extensionsDirectory, providerObservationPath: observationPath }) {
  await Promise.all([
    writeFile(join(agentDir, "settings.json"), "{}\n", { encoding: "utf8", mode: 0o600 }),
    writeFile(join(agentDir, "openviking.json"), `${JSON.stringify({
      endpoint,
      enabled: true,
      privacyMode: "private-learning",
      recallQueryExpansion: "off",
      takeover: { enabled: false },
      logLevel: "silent"
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
    writeFile(join(extensionsDirectory, "isolation-provider.ts"), isolationProviderSource(observationPath), "utf8")
  ]);
}

function isolationProviderSource(observationPath) {
  return `
    import { appendFileSync } from "node:fs";
    import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

    export default function packagedIsolationProvider(pi) {
      pi.registerProvider("pi67-isolation", {
        name: "Pi-67 Isolation",
        baseUrl: "https://pi67.invalid",
        apiKey: "synthetic-runtime-only",
        api: "openai-responses",
        models: [{
          id: "isolation",
          name: "Isolated Runtime",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 16384,
          maxTokens: 256
        }],
        streamSimple: (model, context) => {
          const stream = createAssistantMessageEventStream();
          const serialized = JSON.stringify((context.messages ?? []).filter((message) => message?.role === "user"));
          appendFileSync(${JSON.stringify(observationPath)}, JSON.stringify({
            memoryContextBlockCount: (serialized.match(/<pi67-memory-context\\b/g) ?? []).length
          }) + "\\n");
          const output = {
            role: "assistant",
            content: [{ type: "text", text: "Synthetic packaged isolation response." }],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 64,
              output: 8,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 72,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
            },
            stopReason: "stop",
            timestamp: Date.now()
          };
          stream.push({ type: "start", partial: output });
          stream.push({ type: "done", reason: "stop", message: output });
          stream.end();
          return stream;
        }
      });
      pi.on("before_agent_start", async (_event, ctx) => {
        const model = ctx.modelRegistry.find("pi67-isolation", "isolation");
        if (model) await pi.setModel(model);
      });
    }
  `;
}

async function startSyntheticOpenViking({ accountId: expectedAccount, accessValue: expectedAccess, peerId: expectedPeer, userId: expectedUser }) {
  const observations = [];
  let sessionCreated = false;
  const server = createServer(async (request, response) => {
    await drainRequest(request);
    const path = request.url ?? "/";
    const identityMatched = request.headers["x-openviking-account"] === expectedAccount
      && request.headers["x-openviking-user"] === expectedUser
      && request.headers["x-openviking-actor-peer"] === expectedPeer
      && request.headers.authorization === `Bearer ${expectedAccess}`;
    observations.push({ method: request.method ?? "GET", path, identityMatched });
    const send = (statusCode, result) => {
      response.writeHead(statusCode, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: statusCode < 400 ? "ok" : "error", result }));
    };
    if (path === "/health") {
      send(200, { version: "0.4.16-isolated-double" });
    } else if (path === "/api/v1/system/status") {
      send(200, { user: expectedUser });
    } else if (path.startsWith("/api/v1/fs/ls")) {
      send(200, []);
    } else if (path === "/api/v1/sessions" && request.method === "POST") {
      sessionCreated = true;
      send(200, {});
    } else if (/^\/api\/v1\/sessions\/[^/]+$/u.test(path) && request.method === "GET") {
      send(sessionCreated ? 200 : 404, sessionCreated ? {} : null);
    } else if (path.includes("/context?") && request.method === "GET") {
      send(sessionCreated ? 200 : 404, sessionCreated ? { messages: [] } : null);
    } else if (path === "/api/v1/search/find") {
      send(200, { memories: [], resources: [], skills: [], total: 0 });
    } else if (path === "/api/v1/search/search") {
      send(200, { entries: [], rendered: "", digest: "", stats: {} });
    } else {
      send(200, {});
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic OpenViking did not bind TCP.");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    observations,
    close: () => new Promise((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    })
  };
}

async function drainRequest(request) {
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error("Synthetic OpenViking request exceeded 1 MiB.");
  }
}

async function readModelContext(path) {
  const entries = (await readFile(path, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return {
    observationCount: entries.length,
    memoryContextBlockCount: entries.reduce((sum, entry) => sum + entry.memoryContextBlockCount, 0)
  };
}

async function readBoundedNdjson(path) {
  try {
    return (await readFile(path, "utf8"))
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(-50)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error("Timed out waiting for packaged isolation evidence.");
}

async function endpointUnavailable(endpoint) {
  try {
    await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(500) });
    return false;
  } catch {
    return true;
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

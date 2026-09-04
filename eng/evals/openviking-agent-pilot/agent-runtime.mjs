import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createInMemoryPiWorkspaceRuntimeServices,
  PiSdkRuntime,
} from "../../../packages/pi-runtime/dist/index.mjs";

import { expectedForTurn } from "./corpus.mjs";
import { modelCatalog } from "./provider-config.mjs";

const extensionPackageRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const providerId = "pi67-agent-pilot";

export async function inspectAgentPilotAssembly(options) {
  const runtimeRoot = join(options.isolationRoot, "runtime-assembly");
  const workspace = join(runtimeRoot, "workspace");
  const agentDir = join(runtimeRoot, "agent");
  const storageRoot = join(runtimeRoot, "desktop-state");
  const home = join(runtimeRoot, "home");
  const stateRoot = join(runtimeRoot, "openviking-state");
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
    mkdir(storageRoot, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(stateRoot, { recursive: true }),
  ]);
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(modelCatalog(options.provider, options.limits), null, 2)}\n`,
    "utf8",
  );

  const environment = isolatedEnvironment({
    profile: "no-memory",
    agentDir,
    home,
    stateRoot,
    storageRoot,
    openViking: {
      baseUrl: options.openVikingBaseUrl,
      userKey: "preflight-no-credential",
      accountId: "preflight-no-account",
      userId: "preflight-no-user",
      peerId: "preflight-no-peer",
    },
  });
  let runtime;
  let services;
  try {
    applyEnvironment(environment.next);
    services = createInMemoryPiWorkspaceRuntimeServices({
      cwd: workspace,
      agentDir,
      projectTrusted: true,
      sessionCatalogDirectory: join(storageRoot, "session-catalog"),
      storageRoot,
    });
    services.settingsManager.setPackages([extensionPackageRoot]);
    await services.settingsManager.flush();
    runtime = new PiSdkRuntime({ workspaceServices: services });
    const initial = await runtime.initialize({
      cwd: workspace,
      agentDir,
      trust: "trusted",
      approvalMode: "balanced",
    });
    const catalog = runtime.getExtensionCatalog();
    return {
      extensionLoaded: initial.resources.some((resource) => resource.kind === "extension"),
      extensionCatalogItems: catalog.total,
      modelLoaded: runtime.getModels().some((model) => (
        model.provider === providerId && model.id === options.provider.modelId
      )),
    };
  } finally {
    await runtime?.dispose().catch(() => undefined);
    await services?.dispose().catch(() => undefined);
    restoreEnvironment(environment.previous);
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}

export async function runAgentScenario(options) {
  const runtimeRoot = join(options.isolationRoot, `${options.sequence}-${options.profile}-${options.scenario.id}`);
  const workspace = join(runtimeRoot, "workspace");
  const agentDir = join(runtimeRoot, "agent");
  const storageRoot = join(runtimeRoot, "desktop-state");
  const home = join(runtimeRoot, "home");
  const stateRoot = join(runtimeRoot, "openviking-state");
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
    mkdir(storageRoot, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(stateRoot, { recursive: true }),
  ]);
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(modelCatalog(options.provider.public, options.limits), null, 2)}\n`,
    "utf8",
  );

  const environment = isolatedEnvironment({
    profile: options.profile,
    agentDir,
    home,
    stateRoot,
    storageRoot,
    openViking: options.openViking,
  });
  const previousFetch = globalThis.fetch.bind(globalThis);
  const monitor = createRequestMonitor({
    originalFetch: previousFetch,
    providerBaseUrl: options.provider.public.providerBaseUrl,
    openVikingBaseUrl: options.openViking.baseUrl,
    maxProviderRequests: options.scenario.turns.length * options.limits.providerRequestsPerTurn,
  });
  let runtime;
  let services;
  let sessionPath = "";
  let result;

  try {
    applyEnvironment(environment.next);
    globalThis.fetch = monitor.fetch;
    services = createInMemoryPiWorkspaceRuntimeServices({
      cwd: workspace,
      agentDir,
      projectTrusted: true,
      sessionCatalogDirectory: join(storageRoot, "session-catalog"),
      storageRoot,
    });
    services.settingsManager.setPackages([extensionPackageRoot]);
    await services.settingsManager.flush();
    runtime = new PiSdkRuntime({ workspaceServices: services });
    const extensionErrors = [];
    runtime.subscribe((event) => {
      if (event.type === "extension.compatibilityChanged" && event.payload.status === "unsupported") {
        extensionErrors.push("unsupported-extension");
      }
    });
    const initial = await runtime.initialize({
      cwd: workspace,
      agentDir,
      trust: "trusted",
      approvalMode: "balanced",
    });
    await runtime.setSessionName(`OpenViking Agent Pilot ${options.sequence}`);
    await runtime.setRuntimeApiKey(providerId, options.provider.secret.providerKey);
    await runtime.selectModel(providerId, options.provider.public.modelId);
    const selected = runtime.getSnapshot().selectedModel;
    if (selected?.provider !== providerId || selected.id !== options.provider.public.modelId) {
      throw pilotError("model_selection_failed");
    }
    if (extensionErrors.length > 0) throw pilotError(extensionErrors[0]);
    if (!initial.resources.some((resource) => resource.kind === "extension")) {
      throw pilotError("evaluation_extension_missing");
    }

    const turns = [];
    let messageCount = 0;
    for (const [turnIndex, turn] of options.scenario.turns.entries()) {
      const expected = expectedForTurn(turn, options.evidenceCodes);
      const startedAt = performance.now();
      const requestStart = monitor.providerRequestCount();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.limits.turnTimeoutMs);
      try {
        await runtime.submitPrompt(turn.prompt, undefined, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw pilotError("turn_timeout");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      const page = runtime.getMessagePage({ direction: "older", limit: 200 });
      const delta = page.messages.slice(messageCount);
      messageCount = page.messages.length;
      const assistant = latestAssistantObservation(delta);
      const toolNames = delta.flatMap((message) => message.parts.flatMap((part) => (
        part.type === "tool-call" ? [part.name] : []
      )));
      turns.push({
        index: turnIndex + 1,
        promptSha256: sha256(turn.prompt),
        answerSha256: sha256(assistant.text),
        answerChars: assistant.text.length,
        expectedMatched: assistant.text.includes(expected),
        assistantPartTypes: assistant.partTypes,
        assistantThinkingChars: assistant.thinkingChars,
        assistantHasError: assistant.hasError,
        toolNames,
        providerRequests: monitor.providerRequestCount() - requestStart,
        latencyMs: Math.round(performance.now() - startedAt),
      });
    }

    const snapshot = runtime.getSnapshot();
    sessionPath = snapshot.sessionPath ?? "";
    const usage = sessionPath ? await scanPiUsage(sessionPath) : emptyUsage();
    result = {
      profile: options.profile,
      scenarioId: options.scenario.id,
      scenarioKind: options.scenario.kind,
      repetition: options.repetition,
      sequence: options.sequence,
      status: "pass",
      turns,
      successfulTurns: turns.filter((turn) => turn.expectedMatched).length,
      totalTurns: turns.length,
      toolCalls: toolCounts(turns),
      providerRequests: monitor.providerRequestCount(),
      openVikingRequests: monitor.openVikingRequestCount(),
      openVikingPaths: monitor.openVikingPathCounts(),
      latencyMs: turns.reduce((sum, turn) => sum + turn.latencyMs, 0),
      usage,
      sessionSha256: sessionPath ? sha256(await readFile(sessionPath)) : "",
    };
  } catch (error) {
    await runtime?.abort().catch(() => undefined);
    result = {
      profile: options.profile,
      scenarioId: options.scenario.id,
      scenarioKind: options.scenario.kind,
      repetition: options.repetition,
      sequence: options.sequence,
      status: "failed",
      errorCode: safeErrorCode(error),
      turns: [],
      successfulTurns: 0,
      totalTurns: options.scenario.turns.length,
      toolCalls: {},
      providerRequests: monitor.providerRequestCount(),
      openVikingRequests: monitor.openVikingRequestCount(),
      openVikingPaths: monitor.openVikingPathCounts(),
      latencyMs: 0,
      usage: emptyUsage(),
      sessionSha256: "",
    };
  } finally {
    await runtime?.dispose().catch(() => undefined);
    await services?.dispose().catch(() => undefined);
    globalThis.fetch = previousFetch;
    restoreEnvironment(environment.previous);
  }

  const credentialLiteralMatches = await countCredentialMatches(runtimeRoot, [
    options.provider.secret.providerKey,
    options.openViking.userKey,
  ]);
  await rm(runtimeRoot, { recursive: true, force: true });
  return { ...result, credentialLiteralMatches, isolatedRuntimeDeleted: true };
}

function isolatedEnvironment({ profile, agentDir, home, stateRoot, storageRoot, openViking }) {
  const next = {
    HOME: home,
    PI_CODING_AGENT_DIR: agentDir,
    PI_AGENT_DIR: agentDir,
    PI67_STORAGE_ROOT: storageRoot,
    PI67_AGENT_PROFILE_FRESH: "1",
    PI67_OPENVIKING_AGENT_PROFILE: profile,
    OPENVIKING_CREDENTIAL_SOURCE: "env",
    OPENVIKING_URL: openViking.baseUrl,
    OPENVIKING_API_KEY: openViking.userKey,
    OPENVIKING_ACCOUNT: openViking.accountId,
    OPENVIKING_USER: openViking.userId,
    OPENVIKING_PEER_ID: openViking.peerId,
    OPENVIKING_WORKSPACE_PEER: "false",
    OPENVIKING_RECALL_PEER_SCOPE: "actor",
    OPENVIKING_STATE_DIR: stateRoot,
    OPENVIKING_CONFIG_FILE: "",
    OPENVIKING_CLI_CONFIG_FILE: "",
    PI67_CAPABILITY_PACKAGE_PATHS: "",
    PI67_MANAGED_CAPABILITIES_ROOT: "",
  };
  return {
    next,
    previous: new Map(Object.keys(next).map((key) => [key, process.env[key]])),
  };
}

function applyEnvironment(environment) {
  for (const [key, value] of Object.entries(environment)) process.env[key] = value;
}

function restoreEnvironment(previous) {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function createRequestMonitor({ originalFetch, providerBaseUrl, openVikingBaseUrl, maxProviderRequests }) {
  const providerOrigin = new URL(providerBaseUrl).origin;
  const openVikingOrigin = new URL(openVikingBaseUrl).origin;
  let providerRequests = 0;
  let openVikingRequests = 0;
  const openVikingPaths = new Map();
  return {
    fetch: async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin === providerOrigin) {
        providerRequests += 1;
        if (providerRequests > maxProviderRequests) throw pilotError("provider_request_budget_exceeded");
      }
      if (url.origin === openVikingOrigin) {
        openVikingRequests += 1;
        openVikingPaths.set(url.pathname, (openVikingPaths.get(url.pathname) ?? 0) + 1);
      }
      return originalFetch(input, init);
    },
    providerRequestCount: () => providerRequests,
    openVikingRequestCount: () => openVikingRequests,
    openVikingPathCounts: () => Object.fromEntries([...openVikingPaths.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

async function scanPiUsage(path) {
  const content = await readFile(path, "utf8");
  const usage = emptyUsage();
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const value = entry?.type === "message" && entry?.message?.role === "assistant"
      ? entry.message.usage
      : undefined;
    if (!value) continue;
    usage.input += finite(value.input);
    usage.output += finite(value.output);
    usage.cacheRead += finite(value.cacheRead);
    usage.cacheWrite += finite(value.cacheWrite);
    usage.totalTokens += finite(value.totalTokens);
    usage.cost += finite(value.cost?.total);
    usage.assistantMessages += 1;
  }
  return usage;
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, assistantMessages: 0 };
}

function latestAssistantObservation(messages) {
  const assistant = messages.findLast((message) => message.role === "assistant");
  const text = assistant?.parts.flatMap((part) => (
    part.type === "text" ? [part.text] : []
  )).join("\n") ?? "";
  const thinkingChars = assistant?.parts.reduce((sum, part) => (
    sum + (part.type === "thinking" ? part.text.length : 0)
  ), 0) ?? 0;
  return {
    text,
    partTypes: [...new Set(assistant?.parts.map((part) => part.type) ?? [])],
    thinkingChars,
    hasError: Boolean(assistant?.error),
  };
}

function toolCounts(turns) {
  const counts = {};
  for (const name of turns.flatMap((turn) => turn.toolNames)) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}

async function countCredentialMatches(root, credentials) {
  let matches = 0;
  for (const path of await listFiles(root)) {
    const file = await stat(path);
    if (!file.isFile() || file.size > 8 * 1024 * 1024) continue;
    const bytes = await readFile(path);
    for (const credential of credentials.filter(Boolean)) matches += countOccurrences(bytes, Buffer.from(credential));
  }
  return matches;
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function countOccurrences(bytes, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = bytes.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pilotError(code) {
  return Object.assign(new Error(code), { code });
}

function safeErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : error?.name;
  return /^[a-z0-9._-]{1,100}$/iu.test(code ?? "") ? code : "agent_run_failed";
}

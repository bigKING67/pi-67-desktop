import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_CONTEXT_MEMORY_CONFIGURATION,
  MEMORY_PRIVACY_MODES,
  type ContextMemoryConfiguration
} from "@pi67/domain";
import type { ContextMemoryConfigurationUpdate } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";

export class ContextMemoryConfigurationStore {
  readonly path: string;

  constructor(agentDir: string) {
    this.path = join(agentDir, "openviking.json");
  }

  async read(): Promise<ContextMemoryConfiguration> {
    const raw = await readFile(this.path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "{}";
      throw error;
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        "OpenViking configuration is not valid JSON. Pi remains available with memory disabled.",
        true
      );
    }
    const configuration = normalizeConfiguration(parsed);
    return { ...configuration, revision: revisionFor(configuration) };
  }

  async update(input: ContextMemoryConfigurationUpdate): Promise<ContextMemoryConfiguration> {
    const current = await this.read();
    if (current.revision !== input.expectedRevision) {
      throw new HostCommandError(
        "RESOURCE_CHANGED_EXTERNALLY",
        "OpenViking configuration changed outside Desktop. Reload before saving.",
        true,
        { expectedRevision: input.expectedRevision, actualRevision: current.revision }
      );
    }
    const next = normalizeConfiguration({
      enabled: input.enabled,
      endpoint: input.endpoint,
      enterpriseGatewayEndpoint: input.enterpriseGatewayEndpoint,
      privacyMode: input.defaultPrivacyMode,
      recallTokenBudget: input.recallTokenBudget,
      scoreThreshold: input.scoreThreshold,
      commitTokenThreshold: input.commitTokenThreshold,
      captureAssistantTurns: input.captureAssistantTurns,
      captureToolResults: false,
      recallPeerScope: "actor",
      experienceRecallLimit: input.privateExperienceLimit,
      sharedExperienceLimit: input.sharedExperienceLimit,
      recallTimeoutMs: current.recallTimeoutMs,
      healthTimeoutMs: current.healthTimeoutMs,
      takeover: input.takeover
    });
    const persisted = {
      enabled: next.enabled,
      endpoint: next.endpoint,
      enterpriseGatewayEndpoint: next.enterpriseGatewayEndpoint,
      privacyMode: next.defaultPrivacyMode,
      recallTokenBudget: next.recallTokenBudget,
      scoreThreshold: next.scoreThreshold,
      commitTokenThreshold: next.commitTokenThreshold,
      captureAssistantTurns: next.captureAssistantTurns,
      captureToolResults: false,
      recallPeerScope: "actor",
      experienceRecallLimit: next.privateExperienceLimit,
      sharedExperienceLimit: next.sharedExperienceLimit,
      recallTimeoutMs: next.recallTimeoutMs,
      healthTimeoutMs: next.healthTimeoutMs,
      takeover: next.takeover
    };
    const temporary = `${this.path}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.path);
    return this.read();
  }
}

function normalizeConfiguration(value: unknown): Omit<ContextMemoryConfiguration, "revision"> {
  const input = record(value);
  const takeoverInput = record(input.takeover);
  const endpoint = normalizeEndpoint(input.endpoint);
  const enterpriseGatewayEndpoint = normalizeOptionalEndpoint(
    input.enterpriseGatewayEndpoint,
    "Enterprise Context Gateway"
  );
  const defaultPrivacyMode = MEMORY_PRIVACY_MODES.includes(input.privacyMode as never)
    ? input.privacyMode as ContextMemoryConfiguration["defaultPrivacyMode"]
    : DEFAULT_CONTEXT_MEMORY_CONFIGURATION.defaultPrivacyMode;
  return {
    ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION,
    enabled: booleanValue(input.enabled, DEFAULT_CONTEXT_MEMORY_CONFIGURATION.enabled),
    endpoint,
    enterpriseGatewayEndpoint,
    defaultPrivacyMode,
    recallTokenBudget: integerValue(input.recallTokenBudget, 0, 20_000, DEFAULT_CONTEXT_MEMORY_CONFIGURATION.recallTokenBudget),
    scoreThreshold: numberValue(input.scoreThreshold, 0, 1, DEFAULT_CONTEXT_MEMORY_CONFIGURATION.scoreThreshold),
    commitTokenThreshold: integerValue(input.commitTokenThreshold, 1_000, 1_000_000, DEFAULT_CONTEXT_MEMORY_CONFIGURATION.commitTokenThreshold),
    captureAssistantTurns: booleanValue(input.captureAssistantTurns, true),
    captureToolResults: false,
    actorScopeOnly: true,
    privateExperienceLimit: integerValue(input.experienceRecallLimit, 0, 5, DEFAULT_CONTEXT_MEMORY_CONFIGURATION.privateExperienceLimit),
    sharedExperienceLimit: integerValue(input.sharedExperienceLimit, 0, 5, DEFAULT_CONTEXT_MEMORY_CONFIGURATION.sharedExperienceLimit),
    recallTimeoutMs: integerValue(input.recallTimeoutMs, 100, 10_000, DEFAULT_CONTEXT_MEMORY_CONFIGURATION.recallTimeoutMs),
    healthTimeoutMs: integerValue(input.healthTimeoutMs, 100, 10_000, DEFAULT_CONTEXT_MEMORY_CONFIGURATION.healthTimeoutMs),
    takeover: {
      enabled: booleanValue(takeoverInput.enabled, DEFAULT_CONTEXT_MEMORY_CONFIGURATION.takeover.enabled),
      tokenThreshold: integerValue(takeoverInput.tokenThreshold, 1_000, 1_000_000, DEFAULT_CONTEXT_MEMORY_CONFIGURATION.takeover.tokenThreshold),
      keepRecentTurns: integerValue(takeoverInput.keepRecentTurns, 1, 20, DEFAULT_CONTEXT_MEMORY_CONFIGURATION.takeover.keepRecentTurns)
    }
  };
}

function normalizeEndpoint(value: unknown): string {
  const candidate = typeof value === "string" && value.trim()
    ? value.trim().replace(/\/+$/, "")
    : DEFAULT_CONTEXT_MEMORY_CONFIGURATION.endpoint;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new HostCommandError("INVALID_PAYLOAD", "OpenViking endpoint must be an absolute HTTP or HTTPS URL.", false);
  }
  if (url.username || url.password || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new HostCommandError(
      "INVALID_PAYLOAD",
      "OpenViking endpoint must not contain credentials and must use HTTP or HTTPS.",
      false
    );
  }
  if (url.search || url.hash) {
    throw new HostCommandError(
      "INVALID_PAYLOAD",
      "OpenViking endpoint must not contain query parameters or fragments.",
      false
    );
  }
  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    throw new HostCommandError(
      "INVALID_PAYLOAD",
      "Remote OpenViking endpoints must use HTTPS; HTTP is limited to loopback.",
      false
    );
  }
  return candidate;
}

function normalizeOptionalEndpoint(value: unknown, label: string): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !value.trim()) {
    throw new HostCommandError("INVALID_PAYLOAD", `${label} endpoint must be an absolute HTTP or HTTPS URL.`, false);
  }
  const candidate = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new HostCommandError("INVALID_PAYLOAD", `${label} endpoint must be an absolute HTTP or HTTPS URL.`, false);
  }
  if (url.username || url.password || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new HostCommandError(
      "INVALID_PAYLOAD",
      `${label} endpoint must not contain credentials and must use HTTP or HTTPS.`,
      false
    );
  }
  if (url.search || url.hash) {
    throw new HostCommandError(
      "INVALID_PAYLOAD",
      `${label} endpoint must not contain query parameters or fragments.`,
      false
    );
  }
  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    throw new HostCommandError(
      "INVALID_PAYLOAD",
      `Remote ${label} endpoints must use HTTPS; HTTP is limited to loopback.`,
      false
    );
  }
  return candidate;
}

function revisionFor(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function integerValue(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function numberValue(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

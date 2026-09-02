import type {
  AgentHostProfileMode,
  AgentHostStartupIssue,
  AgentHostStartupIssueCode,
  AgentHostStartupStageTiming,
  AgentHostStartupStage,
  AgentHostStartupState
} from "@pi67/protocol";
import { lstat, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  bootstrapDesktopCapabilities,
  type DesktopCapabilityBootstrapResult
} from "./desktop-capability-bootstrap.js";
import {
  activateDesktopManagedPackages,
  type ManagedPackageBundleResult
} from "./managed-package-bundle.js";
import {
  provisionManagedBrowser67Mcp,
  type ManagedBrowser67McpResult
} from "./managed-browser67-mcp-provision.js";
import {
  removeRetiredTeamMcpConfig,
  type RetiredTeamMcpCleanupResult
} from "./retired-team-mcp-cleanup.js";

const LEGACY_CAPABILITY_CLEANUP_DELAY_MS = 2 * 60_000;
const DESKTOP_CAPABILITY_STATE_SCHEMA = "pi67.desktop-capability-state.v1";
const MAX_STATE_BYTES = 1_000_000;
const MAX_STARTUP_ISSUES = 8;

interface AgentHostStartupOptions<T> {
  agentDir: string;
  environment?: NodeJS.ProcessEnv;
  constructServer: () => T;
  classifyProfile?: (agentDir: string) => Promise<AgentHostProfileMode>;
  bootstrapCapabilities?: (options: {
    agentDir: string;
    environment: NodeJS.ProcessEnv;
    profileOwnership: "desktop" | "shared";
  }) => Promise<DesktopCapabilityBootstrapResult>;
  activateManagedPackages?: (options: {
    agentDir: string;
    environment: NodeJS.ProcessEnv;
  }) => Promise<ManagedPackageBundleResult>;
  cleanupRetiredMcp?: (options: {
    agentDir: string;
    environment: NodeJS.ProcessEnv;
  }) => Promise<RetiredTeamMcpCleanupResult>;
  provisionBrowser67Mcp?: (options: {
    agentDir: string;
    environment: NodeJS.ProcessEnv;
  }) => Promise<ManagedBrowser67McpResult>;
}

export interface AgentHostStartupResult<T> {
  server: T;
  startup: AgentHostStartupState;
}

export class AgentHostStartupError extends Error {
  readonly issue: AgentHostStartupIssue;
  readonly profileMode: AgentHostProfileMode | undefined;

  constructor(
    issue: AgentHostStartupIssue,
    profileMode?: AgentHostProfileMode,
    options?: ErrorOptions
  ) {
    super(`Agent Host startup failed during ${issue.stage}.`, options);
    this.name = "AgentHostStartupError";
    this.issue = issue;
    this.profileMode = profileMode;
  }
}

export async function coordinateAgentHostStartup<T>(
  options: AgentHostStartupOptions<T>
): Promise<AgentHostStartupResult<T>> {
  const environment = options.environment ?? process.env;
  const agentDir = resolve(options.agentDir);
  const issues: AgentHostStartupIssue[] = [];
  const startupStartedAt = Date.now();
  const stageTimings: AgentHostStartupStageTiming[] = [];
  clearCapabilityProjection(environment);

  const classified = await captureStage(
    "profile-classification",
    () => (options.classifyProfile ?? classifyAgentHostProfile)(agentDir)
  );
  stageTimings.push(stageTiming(classified, "failed"));
  if (!classified.ok) throw startupError("classify-profile", classified.error);
  const profileMode = classified.value;
  environment.PI67_AGENT_PROFILE_FRESH = profileMode === "fresh" ? "1" : "0";

  let capabilities: DesktopCapabilityBootstrapResult | undefined;
  const capabilityStage = await captureStage("desktop-capabilities", () => (
    options.bootstrapCapabilities ?? bootstrapDesktopCapabilities
  )({
      agentDir,
      environment,
      profileOwnership: profileMode === "existing-shared" ? "shared" : "desktop"
    }));
  if (capabilityStage.ok) {
    capabilities = capabilityStage.value;
    stageTimings.push(stageTiming(capabilityStage, "failed"));
  } else {
    stageTimings.push(stageTiming(capabilityStage, profileMode === "fresh" ? "failed" : "degraded"));
    if (profileMode === "fresh") {
      throw startupError("desktop-capabilities", capabilityStage.error, profileMode);
    }
    addIssue(issues, startupIssue("desktop-capabilities", capabilityStage.error));
    clearCapabilityProjection(environment);
  }
  if (
    capabilities?.enabled !== true
    && profileMode === "fresh"
    && environment.PI67_DESKTOP === "1"
    && environment.PI67_PACKAGED === "1"
  ) {
    throw new AgentHostStartupError(
      { stage: "desktop-capabilities", code: "missing-resource" },
      profileMode
    );
  }

  let managedPackages: ManagedPackageBundleResult | undefined;
  if (capabilities?.enabled) {
    const managedPackageStage = await captureStage("managed-packages", async () => {
      const result = await (
        options.activateManagedPackages ?? activateDesktopManagedPackages
      )({ agentDir, environment });
      if (!result.enabled && profileMode === "fresh" && environment.PI67_PACKAGED === "1") {
        throw new AgentHostStartupError(
          { stage: "managed-packages", code: "missing-resource" },
          profileMode
        );
      }
      return result;
    });
    if (managedPackageStage.ok) {
      managedPackages = managedPackageStage.value;
      stageTimings.push(stageTiming(managedPackageStage, "failed"));
    } else {
      stageTimings.push(stageTiming(
        managedPackageStage,
        profileMode === "fresh" ? "failed" : "degraded"
      ));
      resetManagedPackageProjection(environment, capabilities);
      if (profileMode === "fresh") {
        throw startupError("managed-packages", managedPackageStage.error, profileMode);
      }
      addIssue(issues, startupIssue("managed-packages", managedPackageStage.error));
    }
  } else {
    stageTimings.push(skippedStageTiming("managed-packages"));
  }

  if (profileMode !== "existing-shared") {
    const cleanupStage = await captureStage("retired-mcp-cleanup", () => (
      options.cleanupRetiredMcp ?? removeRetiredTeamMcpConfig
    )({
        agentDir,
        environment
      }));
    if (cleanupStage.ok) {
      const cleanup = cleanupStage.value;
      const cleanupIssue = retiredCleanupIssue(cleanup);
      if (cleanupIssue) addIssue(issues, cleanupIssue);
      const timing = stageTiming(cleanupStage, "failed");
      if (cleanupIssue) timing.outcome = "degraded";
      stageTimings.push(timing);
    } else {
      stageTimings.push(stageTiming(cleanupStage, "degraded"));
      addIssue(issues, startupIssue("retired-mcp-cleanup", cleanupStage.error));
    }
  } else {
    stageTimings.push(skippedStageTiming("retired-mcp-cleanup"));
  }

  if (capabilities?.enabled) {
    const browserStage = await captureStage("browser67-mcp", () => (
        options.provisionBrowser67Mcp ?? provisionManagedBrowser67Mcp
      )({ agentDir, environment }));
    if (browserStage.ok) {
      const browser67 = browserStage.value;
      const browserIssues = managedBrowser67Issues(browser67);
      for (const issue of browserIssues) addIssue(issues, issue);
      const timing = stageTiming(browserStage, "failed");
      if (browserIssues.length > 0) timing.outcome = "degraded";
      stageTimings.push(timing);
    } else {
      stageTimings.push(stageTiming(browserStage, profileMode === "fresh" ? "failed" : "degraded"));
      if (profileMode === "fresh") throw startupError("browser67-mcp", browserStage.error, profileMode);
      addIssue(issues, startupIssue("browser67-mcp", browserStage.error));
    }
  } else {
    stageTimings.push(skippedStageTiming("browser67-mcp"));
  }

  const serverStage = captureSynchronousStage("server-construction", options.constructServer);
  stageTimings.push(stageTiming(serverStage, "failed"));
  if (!serverStage.ok) throw startupError("server-construction", serverStage.error, profileMode);
  const server = serverStage.value;
  scheduleLegacyCapabilityCleanup(agentDir, capabilities, managedPackages);
  return {
    server,
    startup: {
      profileMode,
      status: issues.length === 0 ? "ready" : "degraded",
      issues,
      totalDurationMs: boundedDuration(Date.now() - startupStartedAt),
      stageTimings,
      ...(capabilities?.projectionMode === undefined
        ? {}
        : { capabilityProjectionMode: capabilities.projectionMode })
    }
  };
}

export async function classifyAgentHostProfile(agentDir: string): Promise<AgentHostProfileMode> {
  const resolvedAgentDir = resolve(agentDir);
  try {
    const metadata = await lstat(resolvedAgentDir);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("The Pi Agent Profile root is not a real directory.");
    }
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return "fresh";
    throw error;
  }

  const statePath = join(resolvedAgentDir, "desktop-capabilities", "state.json");
  try {
    const metadata = await lstat(statePath);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_STATE_BYTES) {
      return "existing-shared";
    }
    const value = JSON.parse(await readFile(statePath, "utf8")) as unknown;
    if (!isDesktopCapabilityState(value)) return "existing-shared";
    return value.profileOwnership === "desktop"
      ? "desktop-managed-upgrade"
      : "existing-shared";
  } catch {
    return "existing-shared";
  }
}

function isDesktopCapabilityState(value: unknown): value is Record<string, unknown> {
  if (
    !isRecord(value)
    || value.schema !== DESKTOP_CAPABILITY_STATE_SCHEMA
    || !isBoundedString(value.catalogVersion, 100)
    || !Array.isArray(value.packages)
    || value.packages.length === 0
    || value.packages.length > 64
    || (value.rules !== "installed" && value.rules !== "unavailable")
    || !["installed", "user-owned", "unavailable"].includes(String(value.agents))
    || (value.profileOwnership !== undefined
      && value.profileOwnership !== "desktop"
      && value.profileOwnership !== "shared")
    || !Number.isSafeInteger(value.preparedAt)
    || Number(value.preparedAt) < 0
  ) return false;
  return value.packages.every((entry) => (
    isRecord(entry)
    && isBoundedString(entry.id, 100)
    && isBoundedString(entry.displayName, 200)
    && Array.isArray(entry.resourceTypes)
    && entry.resourceTypes.length > 0
    && entry.resourceTypes.length <= 16
    && entry.resourceTypes.every((resourceType) => isBoundedString(resourceType, 100))
    && /^[a-f0-9]{64}$/u.test(String(entry.treeSha256))
    && entry.installed === true
    && Number.isSafeInteger(entry.packageIndex)
    && Number(entry.packageIndex) >= 0
  ));
}

function retiredCleanupIssue(
  result: RetiredTeamMcpCleanupResult
): AgentHostStartupIssue | undefined {
  if (result.status === "revision-conflict") {
    return { stage: "retired-mcp-cleanup", code: "conflict" };
  }
  if (result.status === "invalid-json") {
    return { stage: "retired-mcp-cleanup", code: "invalid-state" };
  }
  return undefined;
}

function managedBrowser67Issues(result: ManagedBrowser67McpResult): AgentHostStartupIssue[] {
  const issues: AgentHostStartupIssue[] = [];
  if (result.status === "revision-conflict") {
    addIssue(issues, { stage: "browser67-mcp", code: "conflict" });
  } else if (result.status === "invalid-json") {
    addIssue(issues, { stage: "browser67-mcp", code: "invalid-state" });
  }
  if (result.cacheStatus === "revision-conflict") {
    addIssue(issues, { stage: "browser67-mcp", code: "conflict" });
  } else if (result.cacheStatus === "invalid-json") {
    addIssue(issues, { stage: "browser67-mcp", code: "invalid-state" });
  }
  return issues;
}

function startupError(
  stage: AgentHostStartupStage,
  error: unknown,
  profileMode?: AgentHostProfileMode
): AgentHostStartupError {
  if (error instanceof AgentHostStartupError) return error;
  return new AgentHostStartupError(startupIssue(stage, error), profileMode, { cause: error });
}

function startupIssue(stage: AgentHostStartupStage, error: unknown): AgentHostStartupIssue {
  return { stage, code: classifyStartupIssueCode(error) };
}

function classifyStartupIssueCode(error: unknown): AgentHostStartupIssueCode {
  const code = nodeErrorCode(error);
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "access-denied";
  if (code === "ENOENT") return "missing-resource";
  if (["EIO", "ENOSPC", "EMFILE", "ENFILE"].includes(code ?? "")) return "io";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/\bconflict\b|changed externally|revision/u.test(message)) return "conflict";
  if (/integrity|sha-?256|hash|manifest|catalog/u.test(message)) return "integrity-failure";
  if (/invalid|malformed|parse|json/u.test(message)) return "invalid-state";
  if (/missing|unavailable|requires|not found/u.test(message)) return "missing-resource";
  return "unknown";
}

function addIssue(issues: AgentHostStartupIssue[], issue: AgentHostStartupIssue): void {
  if (
    issues.length >= MAX_STARTUP_ISSUES
    || issues.some((candidate) => candidate.stage === issue.stage && candidate.code === issue.code)
  ) return;
  issues.push(issue);
}

function clearCapabilityProjection(environment: NodeJS.ProcessEnv): void {
  delete environment.PI67_BUNDLED_CAPABILITIES_ROOT;
  delete environment.PI67_MANAGED_CAPABILITIES_ROOT;
  delete environment.PI67_SHARED_PROFILE_ROOT;
  delete environment.PI67_CAPABILITY_PACKAGE_PATHS;
  delete environment.PI67_KNOWN_PACKAGE_BASELINES;
  delete environment.PI67_MANAGED_NPM_ROOT;
  delete environment.PI67_MANAGED_EXTENSION_PATHS;
  delete environment.PI67_OPENVIKING_SHARED_PROJECTION;
}

function resetManagedPackageProjection(
  environment: NodeJS.ProcessEnv,
  capabilities: DesktopCapabilityBootstrapResult
): void {
  delete environment.PI67_MANAGED_NPM_ROOT;
  delete environment.PI67_MANAGED_EXTENSION_PATHS;
  environment.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify(capabilities.packagePaths);
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isNodeError(error: unknown, code: string): boolean {
  return nodeErrorCode(error) === code;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type CapturedStage<T> = {
  ok: true;
  stage: AgentHostStartupStageTiming["stage"];
  durationMs: number;
  value: T;
} | {
  ok: false;
  stage: AgentHostStartupStageTiming["stage"];
  durationMs: number;
  error: unknown;
};

async function captureStage<T>(
  stage: AgentHostStartupStageTiming["stage"],
  operation: () => Promise<T>
): Promise<CapturedStage<T>> {
  const startedAt = Date.now();
  try {
    const value = await operation();
    return { ok: true, stage, durationMs: boundedDuration(Date.now() - startedAt), value };
  } catch (error) {
    return { ok: false, stage, durationMs: boundedDuration(Date.now() - startedAt), error };
  }
}

function captureSynchronousStage<T>(
  stage: AgentHostStartupStageTiming["stage"],
  operation: () => T
): CapturedStage<T> {
  const startedAt = Date.now();
  try {
    const value = operation();
    return { ok: true, stage, durationMs: boundedDuration(Date.now() - startedAt), value };
  } catch (error) {
    return { ok: false, stage, durationMs: boundedDuration(Date.now() - startedAt), error };
  }
}

function stageTiming<T>(
  stage: CapturedStage<T>,
  failedOutcome: "degraded" | "failed"
): AgentHostStartupStageTiming {
  return {
    stage: stage.stage,
    durationMs: stage.durationMs,
    outcome: stage.ok ? "completed" : failedOutcome
  };
}

function skippedStageTiming(stage: AgentHostStartupStageTiming["stage"]): AgentHostStartupStageTiming {
  return { stage, durationMs: 0, outcome: "skipped" };
}

function boundedDuration(value: number): number {
  return Math.min(10 * 60_000, Math.max(0, Math.round(value)));
}

function scheduleLegacyCapabilityCleanup(
  agentDir: string,
  capabilities: DesktopCapabilityBootstrapResult | undefined,
  managedPackages: ManagedPackageBundleResult | undefined
): void {
  if (capabilities?.projectionMode !== "packaged-direct") return;
  const paths = [join(agentDir, "desktop-capabilities", "packages")];
  if (managedPackages?.projectionMode === "packaged-direct") {
    const managedRoot = join(agentDir, "desktop-capabilities", "managed-packages");
    paths.push(
      join(managedRoot, "active"),
      join(managedRoot, "previous"),
      join(managedRoot, "staging")
    );
  }
  const timer = setTimeout(() => {
    void Promise.all(paths.map((path) => rm(path, { recursive: true, force: true }).catch(() => undefined)));
  }, LEGACY_CAPABILITY_CLEANUP_DELAY_MS);
  timer.unref?.();
}

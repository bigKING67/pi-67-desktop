import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import {
  defaultPackageNetworkSettings,
  gitSourceCandidates,
  npmRegistryCandidates,
  parsePackageNetworkSettings,
  type PackageNetworkSettings
} from "@pi67/domain";
import {
  createDesktopPackageOperationRuntime,
  type DesktopPackageOperationRuntime
} from "@pi67/pi-runtime";
import { isProtocolErrorCode } from "@pi67/protocol";
import {
  isPackageWorkerMessageWithinByteLimit,
  isPackageWorkerRequest,
  type PackageWorkerRequest,
  type PackageWorkerResponse
} from "./package-worker-protocol.js";
import {
  checkGitPackageUpdatesWithFallback,
  GitPackageSourcesUnavailableError
} from "./package-worker-git-fallback.js";

const MAX_NETWORK_SETTINGS_BYTES = 32 * 1_024;
const SOURCE_PROBE_TIMEOUT_MS = 8_000;

process.once("message", (message: unknown) => {
  if (!isPackageWorkerRequest(message)) {
    send({
      type: "package-worker-response",
      requestId: "invalid",
      ok: false,
      error: { code: "INVALID_PAYLOAD", message: "Package worker request is invalid.", recoverable: false }
    });
    return;
  }
  void execute(message)
    .then((result) => send({
      type: "package-worker-response",
      requestId: message.requestId,
      ok: true,
      result
    }))
    .catch((error: unknown) => send({
      type: "package-worker-response",
      requestId: message.requestId,
      ok: false,
      error: workerError(error)
    }));
});

async function execute(request: PackageWorkerRequest): Promise<unknown> {
  if (!isAbsolute(request.cwd) || !isAbsolute(request.agentDir)) {
    throw coded("INVALID_PAYLOAD", "Package worker paths must be absolute.", false);
  }
  const toolchain = privateToolchain();
  const settings = await loadNetworkSettings(request.networkSettingsPath);
  const runtime = createDesktopPackageOperationRuntime({
    cwd: request.cwd,
    agentDir: request.agentDir,
    projectTrusted: request.projectTrusted
  });
  const configuredPackages = request.action === "check-updates" ? runtime.configuredPackages() : [];
  const required = await configureOperationSources(request, settings, runtime, configuredPackages, toolchain);
  switch (request.action) {
    case "check-updates":
      if (!required.git) return runtime.checkForUpdates();
      try {
        return await checkGitPackageUpdatesWithFallback({
          settings,
          packages: configuredPackages.filter((entry) => classifyPackageSource(entry.source).git),
          configureRewrite: configureGitRewrite,
          probe: (installedPath) => runGit(toolchain.git, [
            "-C",
            installedPath,
            "ls-remote",
            "--exit-code",
            "origin",
            "HEAD"
          ]),
          check: () => runtime.checkForUpdates()
        });
      } catch (error) {
        if (!(error instanceof GitPackageSourcesUnavailableError)) throw error;
        throw coded("NO_REACHABLE_PACKAGE_SOURCE", "No reachable Git package source is available.", true, {
          sourceKind: "git",
          attempts: error.attempts
        });
      }
    case "install":
      return runtime.install(request.source!, request.scope!);
    case "update":
      return runtime.update(request.source!, request.scope!);
    case "uninstall":
      return runtime.uninstall(request.source!, request.scope!);
  }
}

async function configureOperationSources(
  request: PackageWorkerRequest,
  settings: PackageNetworkSettings,
  runtime: DesktopPackageOperationRuntime,
  configuredPackages: ReturnType<DesktopPackageOperationRuntime["configuredPackages"]>,
  toolchain: { node: string; npmCli: string; git: string }
): Promise<{ npm: boolean; git: boolean }> {
  const required = requiredSourceKinds(request, configuredPackages);
  if (required.npm) {
    const registry = await selectNpmRegistry(settings);
    runtime.applyNpmCommand([toolchain.node, toolchain.npmCli, "--registry", registry]);
  } else {
    runtime.applyNpmCommand([toolchain.node, toolchain.npmCli]);
  }
  if (required.git && request.action !== "check-updates") {
    const source = await selectGitSource(settings, toolchain.git);
    configureGitRewrite(source?.insteadOfPrefix);
  } else if (!required.git) {
    configureGitRewrite(undefined);
  }
  return required;
}

function requiredSourceKinds(
  request: PackageWorkerRequest,
  configuredPackages: ReturnType<DesktopPackageOperationRuntime["configuredPackages"]>
): { npm: boolean; git: boolean } {
  if (request.action === "uninstall") return { npm: false, git: false };
  if (request.action !== "check-updates") return classifyPackageSource(request.source!);
  return configuredPackages.reduce<{ npm: boolean; git: boolean }>((result, entry) => {
    const kind = classifyPackageSource(entry.source);
    return { npm: result.npm || kind.npm, git: result.git || kind.git };
  }, { npm: false, git: false });
}

async function selectNpmRegistry(settings: PackageNetworkSettings): Promise<string> {
  for (const candidate of npmRegistryCandidates(settings)) {
    try {
      const response = await fetch(`${candidate.url}/-/ping`, {
        signal: AbortSignal.timeout(SOURCE_PROBE_TIMEOUT_MS),
        headers: { Accept: "application/json" }
      });
      if (response.ok) return candidate.url;
    } catch {
      // Try the next configured public source.
    }
  }
  throw coded("NO_REACHABLE_PACKAGE_SOURCE", "No reachable npm package source is available.", true, {
    sourceKind: "npm"
  });
}

async function selectGitSource(settings: PackageNetworkSettings, git: string) {
  for (const candidate of gitSourceCandidates(settings)) {
    try {
      await runGit(git, ["ls-remote", "--exit-code", candidate.transportUrl, "HEAD"]);
      return candidate;
    } catch {
      // Try the next configured public source.
    }
  }
  throw coded("NO_REACHABLE_PACKAGE_SOURCE", "No reachable Git package source is available.", true, {
    sourceKind: "git"
  });
}

function configureGitRewrite(mirrorPrefix: string | undefined): void {
  delete process.env.GIT_CONFIG_KEY_0;
  delete process.env.GIT_CONFIG_VALUE_0;
  if (!mirrorPrefix) {
    process.env.GIT_CONFIG_COUNT = "0";
    return;
  }
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = `url.${mirrorPrefix}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = "https://github.com/";
}

async function loadNetworkSettings(path: string | undefined): Promise<PackageNetworkSettings> {
  if (!path) return defaultPackageNetworkSettings();
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_NETWORK_SETTINGS_BYTES) {
      throw new Error("invalid settings file");
    }
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.schema !== "pi67.package-network.v1") {
      throw new Error("invalid settings schema");
    }
    const settings = parsePackageNetworkSettings(parsed.settings);
    if (!settings) throw new Error("invalid settings payload");
    return settings;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return defaultPackageNetworkSettings();
    throw coded("INVALID_PAYLOAD", "Package network settings are invalid.", false);
  }
}

function privateToolchain(): { node: string; npmCli: string; git: string } {
  const node = process.env.PI67_NODE_EXECUTABLE;
  const npmCli = process.env.PI67_NPM_CLI;
  const git = process.env.PI67_GIT_EXECUTABLE;
  const gitExecPath = process.env.PI67_GIT_EXEC_PATH;
  if (!node || !npmCli || !git || !gitExecPath || !isAbsolute(gitExecPath)) {
    throw coded("TOOLCHAIN_MISSING", "Pi-67 Desktop private package toolchain is unavailable.", false);
  }
  const existingPath = process.env.PATH;
  process.env.PATH = [dirname(node), dirname(git), existingPath].filter(Boolean).join(process.platform === "win32" ? ";" : ":");
  process.env.GIT_TERMINAL_PROMPT = "0";
  process.env.GCM_INTERACTIVE = "never";
  process.env.GIT_EXEC_PATH = gitExecPath;
  return { node, npmCli, git };
}

function runGit(executable: string, arguments_: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      stdio: ["ignore", "ignore", "ignore"],
      env: process.env
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Git source probe timed out."));
    }, SOURCE_PROBE_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error("Git source probe failed."));
    });
  });
}

function classifyPackageSource(source: string): { npm: boolean; git: boolean } {
  const normalized = source.trim();
  if (
    normalized.startsWith("git+")
    || normalized.startsWith("git@")
    || normalized.startsWith("github:")
    || normalized.includes("github.com/")
    || normalized.endsWith(".git")
  ) return { npm: false, git: true };
  if (isAbsolute(normalized) || normalized.startsWith("./") || normalized.startsWith("../")) {
    return { npm: false, git: false };
  }
  return { npm: true, git: false };
}

function workerError(error: unknown): Extract<PackageWorkerResponse, { ok: false }>["error"] {
  if (isCodedError(error)) {
    const message = boundedWorkerErrorMessage(error.message);
    return {
      code: error.code,
      message,
      recoverable: error.recoverable,
      ...(isBoundedErrorDetails(error.details) ? { details: error.details } : {})
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (/node-gyp|node-pre-gyp|native addon|build tools|cmake|msbuild|xcode/iu.test(message)) {
    return {
      code: "NATIVE_BUILD_TOOLCHAIN_REQUIRED",
      message: "This package requires a native build toolchain that is not bundled with Pi-67 Desktop.",
      recoverable: false
    };
  }
  return {
    code: "INTERNAL",
    message: "The isolated Pi package operation failed.",
    recoverable: true
  };
}

function coded(
  code: Extract<PackageWorkerResponse, { ok: false }>["error"]["code"],
  message: string,
  recoverable: boolean,
  details?: Record<string, string | number | boolean>
) {
  return Object.assign(new Error(message), { code, recoverable, details });
}

function isCodedError(error: unknown): error is Error & Extract<PackageWorkerResponse, { ok: false }>["error"] {
  return error instanceof Error
    && "code" in error
    && isProtocolErrorCode(error.code)
    && "recoverable" in error
    && typeof error.recoverable === "boolean";
}

function boundedWorkerErrorMessage(message: string): string {
  const normalized = message.trim();
  return (normalized || "The isolated Pi package operation failed.").slice(0, 2_048);
}

function isBoundedErrorDetails(value: unknown): value is Record<string, string | number | boolean> {
  if (!isRecord(value) || Object.keys(value).length > 32) return false;
  return Object.entries(value).every(([key, detail]) => (
    key.length > 0
    && key.length <= 128
    && (
      (typeof detail === "string" && detail.length <= 2_048)
      || (typeof detail === "number" && Number.isFinite(detail))
      || typeof detail === "boolean"
    )
  ));
}

function send(response: PackageWorkerResponse): void {
  const boundedResponse: PackageWorkerResponse = isPackageWorkerMessageWithinByteLimit(response)
    ? response
    : {
        type: "package-worker-response",
        requestId: response.requestId,
        ok: false,
        error: {
          code: "RESOURCE_LIMIT_EXCEEDED",
          message: "The isolated Pi package worker result exceeded the IPC byte limit.",
          recoverable: false
        }
      };
  process.send?.(boundedResponse);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

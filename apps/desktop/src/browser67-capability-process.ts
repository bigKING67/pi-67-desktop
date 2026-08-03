import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import type { DesktopToolchain } from "./desktop-toolchain.js";

const OPERATION_TIMEOUT_MS = 5 * 60_000;
const MAX_PROCESS_OUTPUT_BYTES = 8_192;
const MAX_JSON_PROCESS_OUTPUT_BYTES = 1_000_000;
const BROWSER67_IDENTITY_FILES = new Set([
  "browser67/build-identity.js",
  "browser67/build-identity.json"
]);

export interface Browser67ExtensionDoctorResult {
  installedCurrent: boolean;
  identityMetadataOnlyDrift: boolean;
  needsSetup: boolean;
  needsCleanSetup: boolean;
  needsBrowserExtensionReload: boolean;
  targetStatus: "missing" | "directory" | "not_directory";
}

export interface Browser67LiveDoctorResult {
  ready: boolean;
  extensionConnected: boolean;
  identityMatch: boolean;
  detail: string;
}

export interface Browser67ProcessRunners {
  runNpm: (registry: string, cwd: string, toolchain: DesktopToolchain) => Promise<void>;
  runBrowserEntrypointCheck: (cwd: string, toolchain: DesktopToolchain) => Promise<void>;
  runBrowserExtensionSetup: (
    cwd: string,
    extensionDirectory: string,
    toolchain: DesktopToolchain
  ) => Promise<void>;
  runBrowserExtensionDoctor: (
    cwd: string,
    extensionDirectory: string,
    toolchain: DesktopToolchain
  ) => Promise<Browser67ExtensionDoctorResult>;
  runBrowserLiveDoctor: (
    cwd: string,
    ensureHub: boolean,
    toolchain: DesktopToolchain
  ) => Promise<Browser67LiveDoctorResult>;
  runBrowserExtensionReload: (cwd: string, toolchain: DesktopToolchain) => Promise<void>;
}

export function browser67DependenciesPrepared(packageRoot: string): boolean {
  return existsSync(join(packageRoot, "node_modules", "ajv", "package.json"))
    && existsSync(join(packageRoot, "node_modules", "ws", "package.json"));
}

export function runBrowser67NpmInstall(
  registry: string,
  cwd: string,
  toolchain: DesktopToolchain
): Promise<void> {
  if (!toolchain.nodeExecutable || !toolchain.npmCli || !toolchain.gitExecutable) {
    return Promise.reject(new Error("Desktop private npm is unavailable."));
  }
  return runSuccessfulProcess(toolchain.nodeExecutable, [
    toolchain.npmCli,
    "ci",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--registry",
    registry
  ], cwd, toolchain).then(() => undefined);
}

export function runBrowser67EntrypointCheck(cwd: string, toolchain: DesktopToolchain): Promise<void> {
  if (!toolchain.nodeExecutable) return Promise.reject(new Error("Desktop private Node is unavailable."));
  return runSuccessfulProcess(
    toolchain.nodeExecutable,
    [join(cwd, "bin", "browser67.mjs"), "--help"],
    cwd,
    toolchain
  ).then(() => undefined);
}

export async function runBrowser67ExtensionSetup(
  cwd: string,
  extensionDirectory: string,
  toolchain: DesktopToolchain
): Promise<void> {
  if (!toolchain.nodeExecutable) throw new Error("Desktop private Node is unavailable.");
  const environment = await browser67CapabilityEnvironment(cwd);
  const output = await runSuccessfulProcess(toolchain.nodeExecutable, [
    join(cwd, "bin", "browser67.mjs"),
    "setup",
    "--json",
    "--skip-registry",
    "--target",
    extensionDirectory
  ], cwd, toolchain, MAX_JSON_PROCESS_OUTPUT_BYTES, environment);
  const payload = parseLastJsonRecord(output, "browser67 setup");
  const extensionDirectoryResult = typeof payload.extension_dir === "string" ? payload.extension_dir : "";
  if (
    payload.ok !== true
    || payload.product !== "browser67"
    || resolve(extensionDirectoryResult) !== resolve(extensionDirectory)
    || payload.mcp_registry_skipped !== true
  ) throw new Error("browser67 setup returned an invalid result.");
}

export async function runBrowser67ExtensionDoctor(
  cwd: string,
  extensionDirectory: string,
  toolchain: DesktopToolchain
): Promise<Browser67ExtensionDoctorResult> {
  if (!toolchain.nodeExecutable) throw new Error("Desktop private Node is unavailable.");
  const environment = await browser67CapabilityEnvironment(cwd);
  const output = await runSuccessfulProcess(toolchain.nodeExecutable, [
    join(cwd, "scripts", "extension-install-doctor.mjs"),
    "--source",
    join(cwd, "extension"),
    "--target",
    extensionDirectory,
    "--json"
  ], cwd, toolchain, MAX_JSON_PROCESS_OUTPUT_BYTES, environment);
  const payload = parseLastJsonRecord(output, "browser67 extension doctor");
  const targetStatus = typeof payload.target_status === "string" ? payload.target_status : "";
  if (
    payload.check !== "extension-install-doctor"
    || typeof payload.installed_current !== "boolean"
    || typeof payload.needs_setup !== "boolean"
    || typeof payload.needs_clean_setup !== "boolean"
    || typeof payload.needs_browser_extension_reload !== "boolean"
    || !["missing", "directory", "not_directory"].includes(targetStatus)
  ) throw new Error("browser67 extension doctor returned an invalid result.");
  const installedCurrent = payload.installed_current as boolean;
  const identityMetadataOnlyDrift = !installedCurrent
    && hasOnlyBrowser67IdentityFileDrift(payload)
    && await installedIdentityMatchesCapabilityLock(cwd, extensionDirectory);
  return {
    installedCurrent,
    identityMetadataOnlyDrift,
    needsSetup: payload.needs_setup,
    needsCleanSetup: payload.needs_clean_setup,
    needsBrowserExtensionReload: payload.needs_browser_extension_reload,
    targetStatus: targetStatus as Browser67ExtensionDoctorResult["targetStatus"]
  };
}

export async function runBrowser67LiveDoctor(
  cwd: string,
  ensureHub: boolean,
  toolchain: DesktopToolchain
): Promise<Browser67LiveDoctorResult> {
  if (!toolchain.nodeExecutable) throw new Error("Desktop private Node is unavailable.");
  const environment = await browser67CapabilityEnvironment(cwd);
  const result = await runCapturedProcess(toolchain.nodeExecutable, [
    join(cwd, "bin", "browser67.mjs"),
    "doctor",
    "--json",
    "--disable-event-log",
    ...(ensureHub ? [] : ["--no-ensure-tmwd-hub"])
  ], cwd, toolchain, MAX_JSON_PROCESS_OUTPUT_BYTES, environment);
  return parseBrowser67LiveDoctorPayload(
    parseLastJsonRecord(result.stdout, "browser67 live doctor"),
    ensureHub
  );
}

export function parseBrowser67LiveDoctorPayload(
  payload: unknown,
  ensureHub: boolean
): Browser67LiveDoctorResult {
  const root = isRecord(payload) ? payload : undefined;
  const doctor = root && isRecord(root.doctor) ? root.doctor : undefined;
  if (!doctor || !isRecord(doctor.checks)) {
    throw new Error("browser67 live doctor returned an invalid result.");
  }
  const routes = [doctor.checks.tmwd_ws_runtime, doctor.checks.tmwd_link_runtime].filter(isRecord);
  const strictMatch = routes.find((route) => (
    route.ok === true
    && route.detail === "extension_identity_ok"
    && route.identity_match === true
  ));
  const provenanceCompatible = routes.find(isProvenanceCompatibleIdentityRoute);
  const verified = strictMatch ?? provenanceCompatible;
  const connected = routes.find((route) => route.extension_connected === true);
  const identityMatch = strictMatch !== undefined || provenanceCompatible !== undefined;
  const mismatch = routes.find((route) => (
    route.extension_connected === true
    && typeof route.detail === "string"
    && route.detail.startsWith("extension_identity_mismatch")
  ));
  const detailRoute = strictMatch
    ?? provenanceCompatible
    ?? mismatch
    ?? connected
    ?? routes.find((route) => typeof route.detail === "string" && route.detail.length > 0);
  const readinessReason = isRecord(doctor.readiness) && typeof doctor.readiness.reason === "string"
    ? doctor.readiness.reason
    : undefined;
  const detail = provenanceCompatible !== undefined && strictMatch === undefined
    ? "extension_identity_compatible_provenance"
    : typeof detailRoute?.detail === "string" && detailRoute.detail.length > 0
      ? detailRoute.detail
      : readinessReason ?? "browser67_not_ready";
  return {
    ready: verified !== undefined && (root?.ok === true || provenanceCompatible !== undefined),
    extensionConnected: connected !== undefined,
    identityMatch,
    detail: browserLiveDetail(detail, ensureHub)
  };
}

export function runBrowser67ExtensionReload(cwd: string, toolchain: DesktopToolchain): Promise<void> {
  if (!toolchain.nodeExecutable) return Promise.reject(new Error("Desktop private Node is unavailable."));
  return runSuccessfulProcess(toolchain.nodeExecutable, [
    join(cwd, "scripts", "reload-extension-live.mjs"),
    "--json"
  ], cwd, toolchain).then(() => undefined);
}

interface CapturedProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

async function runSuccessfulProcess(
  executable: string,
  arguments_: string[],
  cwd: string,
  toolchain: DesktopToolchain,
  maxOutputBytes = MAX_PROCESS_OUTPUT_BYTES,
  environment: NodeJS.ProcessEnv = {}
): Promise<string> {
  const result = await runCapturedProcess(executable, arguments_, cwd, toolchain, maxOutputBytes, environment);
  if (result.code !== 0) {
    throw new Error(
      `Private capability operation exited with ${result.signal ?? result.code}: ${boundedOutput(result)}`
    );
  }
  return result.stdout;
}

function runCapturedProcess(
  executable: string,
  arguments_: string[],
  cwd: string,
  toolchain: DesktopToolchain,
  maxOutputBytes = MAX_PROCESS_OUTPUT_BYTES,
  environment: NodeJS.ProcessEnv = {}
): Promise<CapturedProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: [
          toolchain.nodeExecutable ? dirname(toolchain.nodeExecutable) : undefined,
          toolchain.gitExecutable ? dirname(toolchain.gitExecutable) : undefined,
          process.env.PATH
        ].filter((value): value is string => Boolean(value)).join(delimiter),
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "never",
        ...environment
      }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation();
    };
    timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("Private capability operation timed out.")));
    }, OPERATION_TIMEOUT_MS);
    const capture = (current: string, chunk: Buffer) => {
      if (current.length >= maxOutputBytes) return current;
      return current + chunk.toString("utf8").slice(0, maxOutputBytes - current.length);
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = capture(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = capture(stderr, chunk); });
    child.once("error", (error) => { finish(() => reject(error)); });
    child.once("exit", (code, signal) => {
      finish(() => resolvePromise({ code, signal, stdout, stderr }));
    });
  });
}

async function browser67CapabilityEnvironment(cwd: string): Promise<NodeJS.ProcessEnv> {
  await readBrowser67CapabilityManifest(cwd);
  return {
    BROWSER67_EXTENSION_BUILD_REVISION: "",
    GITHUB_SHA: "",
    GIT_CEILING_DIRECTORIES: dirname(resolve(cwd))
  };
}

async function readBrowser67CapabilityManifest(cwd: string): Promise<{ version: string; gitHead: string }> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  } catch {
    throw new Error("Bundled browser67 package manifest is invalid.");
  }
  if (!isRecord(manifest)) throw new Error("Bundled browser67 package manifest is invalid.");
  const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
  const gitHead = typeof manifest.gitHead === "string" ? manifest.gitHead.trim() : "";
  if (!version || !/^[0-9a-f]{40}$/u.test(gitHead)) {
    throw new Error("Bundled browser67 capability lock revision is invalid.");
  }
  return { version, gitHead };
}

function hasOnlyBrowser67IdentityFileDrift(payload: Record<string, unknown>): boolean {
  const missing = fileNames(payload.missing);
  const extra = fileNames(payload.extra);
  const changed = fileNames(payload.changed);
  return missing?.length === 0
    && extra?.length === 0
    && changed?.length === BROWSER67_IDENTITY_FILES.size
    && changed.every((file) => BROWSER67_IDENTITY_FILES.has(file));
}

function fileNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value.map((entry) => (
    typeof entry === "string"
      ? entry
      : isRecord(entry) && typeof entry.file === "string"
        ? entry.file
        : ""
  ));
  return names.every(Boolean) ? names : undefined;
}

async function installedIdentityMatchesCapabilityLock(cwd: string, extensionDirectory: string): Promise<boolean> {
  try {
    const [capability, identityValue, manifestValue] = await Promise.all([
      readBrowser67CapabilityManifest(cwd),
      readFile(join(extensionDirectory, "browser67", "build-identity.json"), "utf8").then(JSON.parse),
      readFile(join(extensionDirectory, "manifest.json"), "utf8").then(JSON.parse)
    ]);
    if (!isRecord(identityValue) || !isRecord(manifestValue)) return false;
    return identityValue.schema === "browser67.extension-identity.v1"
      && identityValue.product === "browser67"
      && identityValue.extension_version === capability.version
      && identityValue.manifest_version === manifestValue.version
      && identityValue.build_revision === capability.gitHead
      && identityValue.build_inputs_dirty === false
      && typeof identityValue.source_digest === "string"
      && /^[0-9a-f]{64}$/u.test(identityValue.source_digest)
      && Number.isInteger(identityValue.protocol_revision)
      && Number(identityValue.protocol_revision) >= 1;
  } catch {
    return false;
  }
}

function isProvenanceCompatibleIdentityRoute(route: Record<string, unknown>): boolean {
  if (
    route.extension_connected !== true
    || route.extension_identity_status !== "valid"
    || route.expected_identity_available !== true
    || !Array.isArray(route.mismatches)
    || route.mismatches.length !== 1
    || route.mismatches[0] !== "build_revision_source"
    || !isRecord(route.observed_identity)
    || !isRecord(route.expected_identity)
  ) return false;
  const observed = route.observed_identity;
  const expected = route.expected_identity;
  return [
    "schema",
    "product",
    "extension_version",
    "manifest_version",
    "build_revision",
    "build_inputs_dirty",
    "source_digest",
    "protocol_revision"
  ].every((field) => observed[field] === expected[field]);
}

function parseLastJsonRecord(output: string, operation: string): Record<string, unknown> {
  const lines = output.trim().split(/\r?\n/u).filter(Boolean);
  const last = lines.at(-1);
  if (!last) throw new Error(`${operation} returned no output.`);
  try {
    const value: unknown = JSON.parse(last);
    if (!isRecord(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new Error(`${operation} returned invalid JSON.`);
  }
}

function browserLiveDetail(detail: string, ensureHub: boolean): string {
  if (detail === "extension_identity_compatible_provenance") {
    return "browser67 扩展身份与当前锁定版本一致；仅构建来源元数据不同。";
  }
  if (detail === "extension_not_connected") {
    return ensureHub
      ? "browser67 Hub 已启动，但浏览器扩展尚未连接。请确认已加载扩展并打开一个普通网页标签页。"
      : "浏览器扩展尚未连接；可从安装向导启动 Hub 并验证。";
  }
  if (detail.startsWith("extension_identity_mismatch")) {
    return "浏览器中运行的扩展版本与当前内置版本不一致，请重新加载扩展。";
  }
  if (detail.includes("tcp") || detail.includes("unreachable") || detail.includes("no_tmwd")) {
    return ensureHub
      ? "browser67 Hub 未能建立可用连接，请检查本机服务状态后重试。"
      : "browser67 Hub 尚未运行；可从安装向导启动连接并验证。";
  }
  return `browser67 尚未就绪：${detail}`;
}

function boundedOutput(result: CapturedProcessResult): string {
  return `${result.stdout}\n${result.stderr}`.trim().replace(/[\r\n\t]+/gu, " ").slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

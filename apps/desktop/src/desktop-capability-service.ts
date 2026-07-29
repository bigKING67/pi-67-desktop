import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, open, rename } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import {
  npmRegistryCandidates,
  type DesktopCapabilitySnapshot,
  type DesktopIntegrationStatus
} from "@pi67/protocol";
import {
  INTEGRATION_STATE_SCHEMA,
  boundedError,
  emptyCapabilitySnapshot,
  isNodeError,
  parseBrowserState,
  parseBundledCatalog,
  parseManagedState,
  readBoundedJson,
  snapshotFromCatalog,
  type Browser67IntegrationState,
  type BundledCapabilityCatalog,
  type ManagedCapabilityState
} from "./desktop-capability-contract.js";
import type { DesktopToolchain } from "./desktop-toolchain.js";
import type { PackageNetworkSettingsStore } from "./package-network-settings.js";

const NPM_OPERATION_TIMEOUT_MS = 5 * 60_000;
const MAX_PROCESS_OUTPUT_BYTES = 8_192;

export interface DesktopCapabilityServiceOptions {
  capabilitiesRoot: string;
  agentDir: string;
  toolchain: DesktopToolchain;
  packageNetworkSettings: PackageNetworkSettingsStore;
  runNpm?: (registry: string, cwd: string, toolchain: DesktopToolchain) => Promise<void>;
  runBrowserDoctor?: (cwd: string, toolchain: DesktopToolchain) => Promise<void>;
  now?: () => number;
  createToken?: () => string;
}

export class DesktopCapabilityService {
  readonly #capabilitiesRoot: string;
  readonly #managedRoot: string;
  readonly #toolchain: DesktopToolchain;
  readonly #packageNetworkSettings: PackageNetworkSettingsStore;
  readonly #runNpm: NonNullable<DesktopCapabilityServiceOptions["runNpm"]>;
  readonly #runBrowserDoctor: NonNullable<DesktopCapabilityServiceOptions["runBrowserDoctor"]>;
  readonly #now: () => number;
  readonly #createToken: () => string;
  #pending: Promise<void> = Promise.resolve();

  constructor(options: DesktopCapabilityServiceOptions) {
    this.#capabilitiesRoot = resolve(options.capabilitiesRoot);
    this.#managedRoot = join(resolve(options.agentDir), "desktop-capabilities");
    this.#toolchain = options.toolchain;
    this.#packageNetworkSettings = options.packageNetworkSettings;
    this.#runNpm = options.runNpm ?? runPrivateNpmInstall;
    this.#runBrowserDoctor = options.runBrowserDoctor ?? runPrivateBrowserDoctor;
    this.#now = options.now ?? Date.now;
    this.#createToken = options.createToken ?? randomUUID;
  }

  snapshot(): Promise<DesktopCapabilitySnapshot> {
    return this.#enqueue(() => this.#snapshotUnlocked());
  }

  setupBrowser67(): Promise<DesktopCapabilitySnapshot> {
    return this.#enqueue(async () => {
      const packageRoot = await this.#requireBrowser67Package();
      if (!this.#toolchain.ready) throw new Error("Desktop private Node/npm/Git toolchain is unavailable.");
      const candidates = npmRegistryCandidates(await this.#packageNetworkSettings.load());
      if (candidates.length === 0) throw new Error("Package downloads are offline; browser67 dependencies cannot be prepared.");
      let lastError: unknown;
      for (const candidate of candidates) {
        try {
          await this.#runNpm(candidate.url, packageRoot, this.#toolchain);
          await this.#runBrowserDoctor(packageRoot, this.#toolchain);
          await this.#writeBrowserState({
            schema: INTEGRATION_STATE_SCHEMA,
            dependencyState: "prepared",
            doctorState: "degraded",
            detail: "依赖与命令入口已验证；Chrome 扩展和真实 managed browser 连接仍需独立检查。",
            preparedAt: this.#now(),
            checkedAt: this.#now(),
            registry: candidate.url
          });
          return this.#snapshotUnlocked();
        } catch (error) {
          lastError = error;
        }
      }
      await this.#writeBrowserState({
        schema: INTEGRATION_STATE_SCHEMA,
        dependencyState: "failed",
        doctorState: "failed",
        detail: boundedError(lastError),
        checkedAt: this.#now()
      });
      throw new Error(`browser67 dependencies could not be prepared: ${boundedError(lastError)}`);
    });
  }

  doctorBrowser67(): Promise<DesktopCapabilitySnapshot> {
    return this.#enqueue(async () => {
      const packageRoot = await this.#requireBrowser67Package();
      const dependencyState = browserDependenciesPrepared(packageRoot) ? "prepared" as const : "not-prepared" as const;
      if (dependencyState === "not-prepared") {
        await this.#writeBrowserState({
          schema: INTEGRATION_STATE_SCHEMA,
          dependencyState,
          doctorState: "failed",
          detail: "browser67 依赖尚未准备。",
          checkedAt: this.#now()
        });
        return this.#snapshotUnlocked();
      }
      try {
        await this.#runBrowserDoctor(packageRoot, this.#toolchain);
        await this.#writeBrowserState({
          schema: INTEGRATION_STATE_SCHEMA,
          dependencyState,
          doctorState: "degraded",
          detail: "依赖与命令入口可用；Chrome 扩展和真实 managed browser 连接未在本次检查中证明。",
          checkedAt: this.#now()
        });
      } catch (error) {
        await this.#writeBrowserState({
          schema: INTEGRATION_STATE_SCHEMA,
          dependencyState,
          doctorState: "failed",
          detail: boundedError(error),
          checkedAt: this.#now()
        });
      }
      return this.#snapshotUnlocked();
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #snapshotUnlocked(): Promise<DesktopCapabilitySnapshot> {
    let catalog: BundledCapabilityCatalog;
    try {
      catalog = parseBundledCatalog(await readBoundedJson(join(this.#capabilitiesRoot, "catalog.json")));
    } catch (error) {
      return emptyCapabilitySnapshot(boundedError(error));
    }
    let state: ManagedCapabilityState | undefined;
    try {
      state = parseManagedState(await readBoundedJson(join(this.#managedRoot, "state.json")));
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        return {
          ...snapshotFromCatalog(catalog, undefined, await this.#browserStatus()),
          phase: "error",
          detail: boundedError(error)
        };
      }
    }
    const browser = await this.#browserStatus();
    const snapshot = snapshotFromCatalog(catalog, state, browser);
    if (!state) return { ...snapshot, phase: "initializing", detail: "Agent Host 正在准备内置能力。" };
    const allInstalled = snapshot.packages.every((entry) => entry.installed);
    return {
      ...snapshot,
      phase: state.catalogVersion === catalog.catalogVersion && allInstalled ? "ready" : "degraded",
      ...(state.catalogVersion === catalog.catalogVersion && allInstalled
        ? {}
        : { detail: "内置能力版本或本地副本尚未完全就绪。" })
    };
  }

  async #browserStatus(): Promise<DesktopIntegrationStatus> {
    let state: Browser67IntegrationState | undefined;
    try {
      state = parseBrowserState(await readBoundedJson(this.#browserStatePath()));
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        return {
          id: "browser67",
          displayName: "browser67",
          bundled: true,
          dependencyState: "failed",
          doctorState: "failed",
          detail: boundedError(error)
        };
      }
    }
    const prepared = browserDependenciesPrepared(this.#browserPackageRoot());
    return {
      id: "browser67",
      displayName: "browser67",
      bundled: true,
      dependencyState: prepared ? "prepared" : state?.dependencyState ?? "not-prepared",
      doctorState: prepared ? state?.doctorState ?? "not-checked" : "not-checked",
      ...(state?.detail === undefined ? {} : { detail: state.detail }),
      ...(state?.preparedAt === undefined ? {} : { preparedAt: state.preparedAt }),
      ...(state?.checkedAt === undefined ? {} : { checkedAt: state.checkedAt }),
      ...(state?.registry === undefined ? {} : { registry: state.registry })
    };
  }

  async #requireBrowser67Package(): Promise<string> {
    const packageRoot = this.#browserPackageRoot();
    if (!isContained(packageRoot, this.#managedRoot)) throw new Error("browser67 package escaped the managed capability root.");
    const metadata = await lstat(packageRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("browser67 managed package is unavailable.");
    return packageRoot;
  }

  #browserPackageRoot(): string {
    return join(this.#managedRoot, "packages", "browser67");
  }

  #browserStatePath(): string {
    return join(this.#managedRoot, ".state", "integrations", "browser67.json");
  }

  async #writeBrowserState(state: Browser67IntegrationState): Promise<void> {
    const path = this.#browserStatePath();
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.browser67.${process.pid}.${this.#createToken()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    if (process.platform !== "win32") await chmod(path, 0o600);
  }
}

export function resolveDesktopAgentDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.PI_CODING_AGENT_DIR;
  if (!configured) return join(homedir(), ".pi", "agent");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return resolve(homedir(), configured.slice(2));
  }
  return resolve(configured);
}

function browserDependenciesPrepared(packageRoot: string): boolean {
  return existsSync(join(packageRoot, "node_modules", "ajv", "package.json"))
    && existsSync(join(packageRoot, "node_modules", "ws", "package.json"));
}

function runPrivateNpmInstall(registry: string, cwd: string, toolchain: DesktopToolchain): Promise<void> {
  if (!toolchain.nodeExecutable || !toolchain.npmCli || !toolchain.gitExecutable) {
    return Promise.reject(new Error("Desktop private npm is unavailable."));
  }
  return runBoundedProcess(toolchain.nodeExecutable, [
    toolchain.npmCli,
    "ci",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--registry",
    registry
  ], cwd, toolchain);
}

function runPrivateBrowserDoctor(cwd: string, toolchain: DesktopToolchain): Promise<void> {
  if (!toolchain.nodeExecutable) return Promise.reject(new Error("Desktop private Node is unavailable."));
  return runBoundedProcess(toolchain.nodeExecutable, [join(cwd, "bin", "browser67.mjs"), "--help"], cwd, toolchain);
}

function runBoundedProcess(
  executable: string,
  arguments_: string[],
  cwd: string,
  toolchain: DesktopToolchain
): Promise<void> {
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
        GCM_INTERACTIVE: "never"
      }
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Private capability operation timed out."));
    }, NPM_OPERATION_TIMEOUT_MS);
    const capture = (chunk: Buffer) => {
      if (output.length < MAX_PROCESS_OUTPUT_BYTES) {
        output += chunk.toString("utf8").slice(0, MAX_PROCESS_OUTPUT_BYTES - output.length);
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(`Private capability operation exited with ${signal ?? code}: ${output.trim()}`));
    });
  });
}

function isContained(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate)) return false;
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  const fromRoot = relative(normalize(root), normalize(candidate));
  return fromRoot !== ""
    && fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
}

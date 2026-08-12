import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { createInMemoryPiWorkspaceRuntimeServices } from "@pi67/pi-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PackageWorkerClient,
  createWorkerBackedExtensionPackageManagement,
  type PackageWorkerClientOptions,
  type PackageWorkerProcessTreeTerminator,
  type PackageWorkerPort
} from "./package-worker-client.js";
import {
  MAX_PACKAGE_WORKER_MESSAGE_BYTES,
  type PackageWorkerRequest
} from "./package-worker-protocol.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("Isolated Package Worker client", () => {
  it("fails closed instead of using system Node/npm/Git", async () => {
    const services = createInMemoryPiWorkspaceRuntimeServices({
      cwd: process.cwd(),
      agentDir: process.cwd()
    });
    const client = new PackageWorkerClient({ environment: {} });
    await expect(client.run("check-updates", services)).rejects.toMatchObject({
      code: "TOOLCHAIN_MISSING",
      recoverable: false
    });
    await services.dispose();
  });

  it("reloads parent SettingsManager state after a worker mutation", async () => {
    const services = createInMemoryPiWorkspaceRuntimeServices({
      cwd: process.cwd(),
      agentDir: process.cwd()
    });
    const run = vi.fn<PackageWorkerPort["run"]>(async (action, workerServices, target) => {
      expect(action).toBe("install");
      workerServices.settingsManager.setPackages([target!.source]);
      await workerServices.settingsManager.flush();
      return {
        items: [{
          source: target!.source,
          scope: "global",
          enabled: true,
          filtered: false,
          installed: false,
          trustState: "unavailable"
        }],
        total: 1,
        changed: true
      };
    });
    const management = createWorkerBackedExtensionPackageManagement(services, { run });

    await expect(management.install("npm:pi-example", "global")).resolves.toMatchObject({
      changed: true,
      items: [{ source: "npm:pi-example", scope: "global" }]
    });
    expect(run).toHaveBeenCalledOnce();
    await services.dispose();
  });

  it("passes only the bounded package environment and waits for worker exit", async () => {
    const services = createServices();
    const child = new FakePackageWorker(101);
    let spawnOptions: Parameters<NonNullable<PackageWorkerClientOptions["spawnWorker"]>>[2];
    const spawnWorker = vi.fn((_executable, _arguments, options) => {
      spawnOptions = options;
      return child.asChildProcess();
    });
    const terminateProcessTree = vi.fn<PackageWorkerProcessTreeTerminator>(async (worker, termination) => {
      expect(worker).toBe(child.asChildProcess());
      expect(termination.force).toBe(false);
      child.exit(0);
    });
    const client = new PackageWorkerClient({
      environment: desktopEnvironment({
        LANG: "zh_CN.UTF-8",
        LC_ALL: "zh_CN.UTF-8",
        LC_AUTH_TOKEN: "secret-locale-token",
        TAVILY_BRIDGE_MCP_TOKEN: "secret-mcp-token",
        PROVIDER_API_KEY: "secret-provider-key",
        npm_config_auth: "secret-npm-token"
      }),
      spawnWorker,
      terminateProcessTree,
      inspectProcessTree: async (worker) => fakeTreeAlive(worker)
    });

    const result = client.run("check-updates", services);
    const request = await child.request();
    child.emit("message", {
      type: "package-worker-response",
      requestId: request.requestId,
      ok: true,
      result: { items: [], total: 0 }
    });

    await expect(result).resolves.toEqual({ items: [], total: 0 });
    expect(spawnOptions!.stdio).toEqual(["ignore", "ignore", "ignore", "ipc"]);
    expect(spawnOptions!.detached).toBe(process.platform !== "win32");
    expect(spawnOptions!.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      PI_TELEMETRY: "0",
      PI67_DESKTOP: "1",
      PI67_NODE_EXECUTABLE: "/private/toolchain/node/bin/node",
      PI67_NPM_CLI: "/private/toolchain/npm/bin/npm-cli.js",
      PI67_GIT_EXECUTABLE: "/private/toolchain/git/bin/git",
      PI67_GIT_EXEC_PATH: "/private/toolchain/git/libexec/git-core",
      LANG: "zh_CN.UTF-8",
      LC_ALL: "zh_CN.UTF-8"
    });
    expect(spawnOptions!.env).not.toHaveProperty("TAVILY_BRIDGE_MCP_TOKEN");
    expect(spawnOptions!.env).not.toHaveProperty("PROVIDER_API_KEY");
    expect(spawnOptions!.env).not.toHaveProperty("npm_config_auth");
    expect(spawnOptions!.env).not.toHaveProperty("LC_AUTH_TOKEN");
    expect(terminateProcessTree).toHaveBeenCalledOnce();
    await services.dispose();
  });

  it("keeps the Windows IPC root alive until process-tree termination starts", async () => {
    const services = createServices();
    const child = new FakePackageWorker(151);
    const terminateProcessTree = vi.fn<PackageWorkerProcessTreeTerminator>(async (worker) => {
      expect(worker.connected).toBe(true);
      child.exit(0);
      return true;
    });
    const client = new PackageWorkerClient({
      environment: desktopEnvironment(),
      platform: "win32",
      spawnWorker: () => child.asChildProcess(),
      terminateProcessTree,
      inspectProcessTree: async (worker) => fakeTreeAlive(worker)
    });

    const result = client.run("check-updates", services);
    const request = await child.request();
    child.emit("message", {
      type: "package-worker-response",
      requestId: request.requestId,
      ok: true,
      result: { items: [], total: 0 }
    });

    await expect(result).resolves.toEqual({ items: [], total: 0 });
    expect(terminateProcessTree).toHaveBeenCalledOnce();
    expect(child.disconnect).toHaveBeenCalledOnce();
    await services.dispose();
  });

  it("uses two-phase process-tree termination and fences new work during shutdown", async () => {
    const services = createServices();
    const children = [new FakePackageWorker(201), new FakePackageWorker(202)];
    let nextChild = 0;
    const spawnWorker = vi.fn(() => children[nextChild++]!.asChildProcess());
    const terminateProcessTree = vi.fn<PackageWorkerProcessTreeTerminator>(async (worker, termination) => {
      expect(termination.platform).toBe("win32");
      if (termination.force) {
        const child = children.find((candidate) => candidate.asChildProcess() === worker);
        child!.exit(null, "SIGKILL");
        return true;
      }
      return false;
    });
    const client = new PackageWorkerClient({
      environment: desktopEnvironment(),
      platform: "win32",
      terminationGraceMs: 20,
      spawnWorker,
      terminateProcessTree,
      inspectProcessTree: async (worker) => fakeTreeAlive(worker)
    });

    const first = client.run("check-updates", services);
    const second = client.run("check-updates", services);
    await Promise.all(children.map((child) => child.request()));
    const firstFailure = expect(first).rejects.toMatchObject({
      code: "CONNECTION_CLOSED",
      details: { shuttingDown: true }
    });
    const secondFailure = expect(second).rejects.toMatchObject({
      code: "CONNECTION_CLOSED",
      details: { shuttingDown: true }
    });

    const shutdown = client.shutdown(20);
    await expect(client.run("check-updates", services)).rejects.toMatchObject({
      code: "CONNECTION_CLOSED",
      details: { shuttingDown: true }
    });
    await Promise.all([firstFailure, secondFailure]);
    await expect(shutdown).resolves.toBeUndefined();
    expect(terminateProcessTree.mock.calls.filter(([, value]) => !value.force)).toHaveLength(2);
    expect(terminateProcessTree.mock.calls.filter(([, value]) => value.force)).toHaveLength(2);
    expect(spawnWorker).toHaveBeenCalledTimes(2);
    await services.dispose();
  });

  it("does not publish a timeout until the worker process tree has exited", async () => {
    const services = createServices();
    const child = new FakePackageWorker(301);
    const terminateProcessTree = vi.fn<PackageWorkerProcessTreeTerminator>(async (_worker, termination) => {
      if (termination.force) child.exit(null, "SIGKILL");
    });
    const client = new PackageWorkerClient({
      environment: desktopEnvironment(),
      timeoutMs: 1_000,
      terminationGraceMs: 500,
      spawnWorker: () => child.asChildProcess(),
      terminateProcessTree,
      inspectProcessTree: async (worker) => fakeTreeAlive(worker)
    });
    let settled = false;
    const operation = client.run("check-updates", services).finally(() => { settled = true; });
    const result = operation.then(
      () => undefined,
      (error: unknown) => error
    );
    await child.request();

    await vi.waitFor(() => {
      expect(terminateProcessTree.mock.calls.map(([, value]) => value.force)).toEqual([false]);
    }, { timeout: 1_200 });
    expect(settled).toBe(false);
    await expect(result).resolves.toMatchObject({ code: "REQUEST_TIMEOUT" });
    expect(terminateProcessTree.mock.calls.map(([, value]) => value.force)).toEqual([false, true]);
    expect(settled).toBe(true);
    await services.dispose();
  });

  it("fails closed on an oversized correlated IPC response", async () => {
    const services = createServices();
    const child = new FakePackageWorker(401);
    const client = new PackageWorkerClient({
      environment: desktopEnvironment(),
      spawnWorker: () => child.asChildProcess(),
      terminateProcessTree: async () => {
        child.exit(0);
        return true;
      }
    });
    const operation = client.run("check-updates", services);
    const request = await child.request();
    child.emit("message", {
      type: "package-worker-response",
      requestId: request.requestId,
      ok: true,
      result: { value: "x".repeat(MAX_PACKAGE_WORKER_MESSAGE_BYTES) }
    });
    await expect(operation).rejects.toMatchObject({
      code: "RESOURCE_LIMIT_EXCEEDED",
      recoverable: false
    });
    await services.dispose();
  });

  it("attempts forced descendant cleanup when the worker root exits unexpectedly", async () => {
    const services = createServices();
    const child = new FakePackageWorker(501);
    const terminateProcessTree = vi.fn<PackageWorkerProcessTreeTerminator>(async () => undefined);
    const client = new PackageWorkerClient({
      environment: desktopEnvironment(),
      spawnWorker: () => child.asChildProcess(),
      terminateProcessTree,
      inspectProcessTree: async () => false
    });
    const operation = client.run("check-updates", services);
    await child.request();
    child.exit(70);

    await expect(operation).rejects.toMatchObject({ code: "INTERNAL" });
    expect(terminateProcessTree).toHaveBeenCalledOnce();
    expect(terminateProcessTree.mock.calls[0]?.[1]).toMatchObject({ force: true });
    await services.dispose();
  });

  it("does not treat root exit as process-tree cleanup while a descendant remains", async () => {
    const services = createServices();
    const child = new FakePackageWorker(601);
    const terminateProcessTree = vi.fn<PackageWorkerProcessTreeTerminator>(async () => false);
    const client = new PackageWorkerClient({
      environment: desktopEnvironment(),
      terminationGraceMs: 20,
      spawnWorker: () => child.asChildProcess(),
      terminateProcessTree,
      inspectProcessTree: async () => true
    });
    const operation = client.run("check-updates", services);
    await child.request();
    child.exit(70);

    await expect(operation).rejects.toMatchObject({
      code: "RUNTIME_POISONED",
      details: { processTreeCleanup: false }
    });
    expect(terminateProcessTree).toHaveBeenCalledOnce();
    expect(terminateProcessTree.mock.calls[0]?.[1]).toMatchObject({ force: true, deadlineMs: 20 });
    await services.dispose();
  });
});

class FakePackageWorker extends EventEmitter {
  readonly pid: number;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  connected = true;
  readonly sent: unknown[] = [];
  readonly disconnect = vi.fn(() => { this.connected = false; });
  readonly kill = vi.fn(() => true);
  readonly send = vi.fn((message: unknown, callback?: (error: Error | null) => void) => {
    this.sent.push(message);
    callback?.(null);
    return true;
  });
  readonly #child: ChildProcess;

  constructor(pid: number) {
    super();
    this.pid = pid;
    this.#child = this as unknown as ChildProcess;
  }

  asChildProcess(): ChildProcess {
    return this.#child;
  }

  async request(): Promise<PackageWorkerRequest> {
    await vi.waitFor(() => expect(this.sent).toHaveLength(1));
    return this.sent[0] as PackageWorkerRequest;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

function createServices() {
  return createInMemoryPiWorkspaceRuntimeServices({
    cwd: process.cwd(),
    agentDir: process.cwd()
  });
}

function desktopEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PI67_DESKTOP: "1",
    PI67_PACKAGED: "1",
    PI67_TOOLCHAIN_ROOT: "/private/toolchain",
    PI67_NODE_EXECUTABLE: "/private/toolchain/node/bin/node",
    PI67_NPM_CLI: "/private/toolchain/npm/bin/npm-cli.js",
    PI67_GIT_EXECUTABLE: "/private/toolchain/git/bin/git",
    PI67_GIT_EXEC_PATH: "/private/toolchain/git/libexec/git-core",
    PI67_ELECTRON_EXECUTABLE: "/private/electron/Electron",
    PI67_PACKAGE_NETWORK_SETTINGS: "/private/settings/package-network.json",
    PATH: "/usr/bin:/bin",
    HOME: "/Users/test",
    ...overrides
  };
}

function fakeTreeAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

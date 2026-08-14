import { spawn, type ChildProcess } from "node:child_process";
import { join, win32 as windowsPath } from "node:path";
import type {
  PackageWorkerProcessTreeController,
  PackageWorkerProcessTreeInspector,
  PackageWorkerProcessTreeTermination,
  PackageWorkerProcessTreeTerminator
} from "./package-worker-process-tree-contract.js";
import { HostCommandError } from "./protocol-error.js";

type ProcessTreeControllerSpawner = typeof spawn;

export function createWindowsPackageWorkerProcessTreeController(
  environment: NodeJS.ProcessEnv,
  spawnController: ProcessTreeControllerSpawner = spawn
): PackageWorkerProcessTreeController {
  return new WindowsPackageWorkerJobController(environment, spawnController);
}

export async function terminateWindowsPackageWorkerProcessTree(
  child: ChildProcess,
  termination: PackageWorkerProcessTreeTermination
): Promise<boolean> {
  const terminated = await taskkillPackageWorkerTree(child.pid, termination);
  // Preserve the root PID for the forced /T /F phase. Killing only the root
  // here would make descendant cleanup unprovable without a Job Object.
  if (!terminated && termination.force && isChildRunning(child)) child.kill();
  return terminated;
}

export async function inspectWindowsPackageWorkerProcessTree(): Promise<boolean> {
  // Without a Job Object, a dead root PID cannot prove its descendants are gone.
  return true;
}

function taskkillPackageWorkerTree(
  pid: number | undefined,
  termination: PackageWorkerProcessTreeTermination
): Promise<boolean> {
  if (pid === undefined) return Promise.resolve(false);
  const systemRoot = termination.environment.SystemRoot ?? termination.environment.WINDIR;
  if (!systemRoot) return Promise.resolve(false);
  const executable = join(systemRoot, "System32", "taskkill.exe");
  const arguments_ = ["/PID", String(pid), "/T", ...(termination.force ? ["/F"] : [])];
  return new Promise((resolvePromise) => {
    let settled = false;
    const utility = spawn(executable, arguments_, {
      stdio: "ignore",
      windowsHide: true,
      env: windowsProcessUtilityEnvironment(termination.environment)
    });
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      utility.removeAllListeners();
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      utility.kill();
      finish(false);
    }, Math.max(1, Math.min(2_000, termination.deadlineMs)));
    utility.once("error", () => finish(false));
    utility.once("exit", (code) => finish(code === 0));
  });
}

function windowsProcessUtilityEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ["ComSpec", "PATH", "PATHEXT", "SystemRoot", "TEMP", "TMP", "WINDIR"] as const) {
    copyEnvironmentValue(source, environment, key);
  }
  return environment;
}

type WindowsJobControllerMessage = {
  type: "ready" | "status" | "terminated" | "closing";
  activeProcesses: number;
} | {
  type: "error";
  operation: string;
  code: number;
};

class WindowsPackageWorkerJobController implements PackageWorkerProcessTreeController {
  readonly #environment: NodeJS.ProcessEnv;
  readonly #spawnController: ProcessTreeControllerSpawner;
  #controller: ChildProcess | undefined;
  #buffer = "";
  #messages: WindowsJobControllerMessage[] = [];
  #waiter: {
    resolve(message: WindowsJobControllerMessage): void;
    reject(error: unknown): void;
  } | undefined;
  #controllerExit: Promise<void> | undefined;
  #resolveControllerExit: (() => void) | undefined;
  #failure: unknown;
  #attached = false;
  #disposing = false;

  constructor(environment: NodeJS.ProcessEnv, spawnController: ProcessTreeControllerSpawner) {
    this.#environment = environment;
    this.#spawnController = spawnController;
  }

  attach = async (child: ChildProcess): Promise<void> => {
    const executable = this.#environment.PI67_WINDOWS_JOB_CONTROLLER;
    if (!executable || !windowsPath.isAbsolute(executable) || child.pid === undefined) {
      throw packageWorkerJobControllerFailure("unavailable", undefined, false);
    }
    let controller: ChildProcess;
    try {
      controller = this.#spawnController(executable, ["--pid", String(child.pid)], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
        env: windowsProcessUtilityEnvironment(this.#environment)
      });
    } catch {
      throw packageWorkerJobControllerFailure("start-failed", undefined, false);
    }
    this.#controller = controller;
    this.#controllerExit = new Promise((resolve) => { this.#resolveControllerExit = resolve; });
    controller.stdout?.on("data", (chunk: Buffer) => this.#capture(chunk));
    controller.stdout?.on("error", () => this.#fail(this.#controllerFailure("read-failed")));
    controller.stdin?.on("error", () => this.#fail(this.#controllerFailure("write-failed")));
    controller.once("error", () => this.#fail(this.#controllerFailure("start-failed")));
    controller.once("exit", (code, signal) => {
      this.#resolveControllerExit?.();
      if (!this.#disposing) {
        this.#fail(this.#controllerFailure(
          code === 0 && signal === null ? "closed" : "failed"
        ));
      }
    });
    const response = await this.#nextMessage(2_000);
    if (response.type !== "ready" || response.activeProcesses < 1) {
      throw response.type === "error"
        ? packageWorkerJobControllerFailure(response.operation, response.code, false)
        : packageWorkerJobControllerFailure("attach-failed", undefined, false);
    }
    this.#attached = true;
  };

  terminate: PackageWorkerProcessTreeTerminator = async (child, termination) => {
    if (!this.#attached) return terminateWindowsPackageWorkerProcessTree(child, termination);
    if (!termination.force) {
      if (child.connected) {
        try {
          child.disconnect();
        } catch {
          // The Job remains authoritative even if the IPC channel already closed.
        }
      }
      return false;
    }
    const response = await this.#command("terminate", termination.deadlineMs);
    if (response.type !== "terminated") {
      throw response.type === "error"
        ? packageWorkerJobControllerFailure(response.operation, response.code)
        : packageWorkerJobControllerFailure("terminate-failed");
    }
    return response.activeProcesses === 0;
  };

  inspect: PackageWorkerProcessTreeInspector = async (child, _platform, deadlineMs = 250) => {
    if (!this.#attached) return isChildRunning(child);
    const response = await this.#command("inspect", deadlineMs);
    if (response.type !== "status") {
      throw response.type === "error"
        ? packageWorkerJobControllerFailure(response.operation, response.code)
        : packageWorkerJobControllerFailure("inspect-failed");
    }
    return response.activeProcesses > 0;
  };

  async dispose(): Promise<void> {
    if (this.#disposing) return;
    this.#disposing = true;
    const controller = this.#controller;
    if (!controller) return;
    if (controller.exitCode === null && controller.signalCode === null && controller.stdin?.writable) {
      try {
        controller.stdin.write("close\n");
      } catch {
        // Closing the controller process also closes the Job handle.
      }
    }
    if (this.#controllerExit && !await settlesWithin(this.#controllerExit, 500)) controller.kill();
    this.#waiter?.reject(this.#controllerFailure("disposed"));
    this.#waiter = undefined;
    controller.removeAllListeners();
    controller.stdout?.removeAllListeners();
    controller.stdin?.removeAllListeners();
  }

  async #command(command: "inspect" | "terminate", deadlineMs: number): Promise<WindowsJobControllerMessage> {
    const controller = this.#controller;
    if (!controller?.stdin?.writable) throw this.#controllerFailure("closed");
    const response = this.#nextMessage(Math.max(1, Math.min(2_000, deadlineMs)));
    try {
      controller.stdin.write(`${command}\n`);
    } catch {
      this.#fail(this.#controllerFailure("write-failed"));
    }
    return response;
  }

  #controllerFailure(operation: string, code?: number): HostCommandError {
    return packageWorkerJobControllerFailure(operation, code, this.#attached);
  }

  #capture(chunk: Buffer): void {
    if (this.#failure) return;
    this.#buffer += chunk.toString("utf8");
    if (this.#buffer.length > 4_096) {
      this.#fail(this.#controllerFailure("oversized-output"));
      return;
    }
    let lineEnd = this.#buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = this.#buffer.slice(0, lineEnd).trim();
      this.#buffer = this.#buffer.slice(lineEnd + 1);
      if (line.length > 0) {
        const message = parseWindowsJobControllerMessage(line);
        if (!message) {
          this.#fail(this.#controllerFailure("invalid-output"));
          return;
        }
        const waiter = this.#waiter;
        if (waiter) {
          this.#waiter = undefined;
          waiter.resolve(message);
        } else if (this.#messages.length === 0) {
          this.#messages.push(message);
        } else {
          this.#fail(this.#controllerFailure("unexpected-output"));
          return;
        }
      }
      lineEnd = this.#buffer.indexOf("\n");
    }
  }

  #nextMessage(milliseconds: number): Promise<WindowsJobControllerMessage> {
    if (this.#failure) return Promise.reject(this.#failure);
    const queued = this.#messages.shift();
    if (queued) return Promise.resolve(queued);
    if (this.#waiter) return Promise.reject(this.#controllerFailure("concurrent-command"));
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (message: WindowsJobControllerMessage) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        if (this.#waiter !== waiter) return;
        this.#waiter = undefined;
        reject(this.#controllerFailure("timeout"));
      }, milliseconds);
      this.#waiter = waiter;
    });
  }

  #fail(error: unknown): void {
    this.#failure ??= error;
    this.#waiter?.reject(error);
    this.#waiter = undefined;
  }
}

function parseWindowsJobControllerMessage(value: string): WindowsJobControllerMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const type = Reflect.get(parsed, "type");
  if (type === "error") {
    const operation = Reflect.get(parsed, "operation");
    const code = Reflect.get(parsed, "code");
    return typeof operation === "string" && operation.length <= 64
      && Number.isSafeInteger(code) && Number(code) >= 0
      ? { type, operation, code: Number(code) }
      : undefined;
  }
  const activeProcesses = Reflect.get(parsed, "activeProcesses");
  return (type === "ready" || type === "status" || type === "terminated" || type === "closing")
    && Number.isSafeInteger(activeProcesses) && Number(activeProcesses) >= 0
    ? { type, activeProcesses: Number(activeProcesses) }
    : undefined;
}

function packageWorkerJobControllerFailure(
  operation: string,
  code?: number,
  containmentEstablished = true
): HostCommandError {
  return new HostCommandError(
    containmentEstablished ? "RUNTIME_POISONED" : "TOOLCHAIN_INTEGRITY_FAILED",
    containmentEstablished
      ? "The Windows Package Worker Job controller could not prove process-tree containment."
      : "The Windows Package Worker Job controller could not establish process-tree containment.",
    false,
    {
      ...(containmentEstablished
        ? { processTreeCleanup: false }
        : { containmentEstablished: false, requestDispatched: false }),
      jobControllerOperation: operation.slice(0, 64),
      ...(code === undefined ? {} : { jobControllerCode: code })
    }
  );
}

function copyEnvironmentValue(
  source: NodeJS.ProcessEnv,
  destination: NodeJS.ProcessEnv,
  key: string
): void {
  const value = source[key];
  if (typeof value === "string") destination[key] = value;
}

function settlesWithin(promise: Promise<void>, milliseconds: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => finish(false), milliseconds);
    void promise.then(() => finish(true));
  });
}

function isChildRunning(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

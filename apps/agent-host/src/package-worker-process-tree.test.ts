import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPackageWorkerProcessTreeController,
  terminatePackageWorkerProcessTree
} from "./package-worker-process-tree.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("Package Worker process-tree ownership", () => {
  it("assigns a Windows worker to the Job before inspection and forced termination", async () => {
    const worker = new FakeWorker(711);
    const helper = new FakeJobController();
    const spawnController = vi.fn(() => helper.asChildProcess());
    const controller = createPackageWorkerProcessTreeController("win32", {
      PI67_WINDOWS_JOB_CONTROLLER: "C:\\Program Files\\Pi-67\\pi67-package-worker-job.exe",
      SystemRoot: "C:\\Windows"
    }, spawnController as never);

    const attached = controller.attach(worker.asChildProcess());
    helper.message({ type: "ready", activeProcesses: 1 });
    await attached;

    expect(spawnController).toHaveBeenCalledWith(
      "C:\\Program Files\\Pi-67\\pi67-package-worker-job.exe",
      ["--pid", "711"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "ignore"], windowsHide: true })
    );
    await expect(controller.terminate(worker.asChildProcess(), {
      force: false,
      platform: "win32",
      environment: {},
      deadlineMs: 250
    })).resolves.toBe(false);
    expect(worker.disconnect).toHaveBeenCalledOnce();

    const inspected = controller.inspect(worker.asChildProcess(), "win32");
    helper.message({ type: "status", activeProcesses: 1 });
    await expect(inspected).resolves.toBe(true);

    const terminated = controller.terminate(worker.asChildProcess(), {
      force: true,
      platform: "win32",
      environment: {},
      deadlineMs: 250
    });
    helper.message({ type: "terminated", activeProcesses: 0 });
    await expect(terminated).resolves.toBe(true);

    const disposed = controller.dispose();
    helper.exit(0);
    await disposed;
    expect(helper.commands).toEqual(["inspect\n", "terminate\n", "close\n"]);
  });

  it("keeps the Windows root PID for the forced tree-kill phase", async () => {
    const worker = new FakeWorker(712);

    await expect(terminatePackageWorkerProcessTree(worker.asChildProcess(), {
      force: false,
      platform: "win32",
      environment: {},
      deadlineMs: 20
    })).resolves.toBe(false);
    expect(worker.kill).not.toHaveBeenCalled();

    await expect(terminatePackageWorkerProcessTree(worker.asChildProcess(), {
      force: true,
      platform: "win32",
      environment: {},
      deadlineMs: 20
    })).resolves.toBe(false);
    expect(worker.kill).toHaveBeenCalledOnce();
  });

  it("preserves a spawn failure when the Windows worker never received a PID", async () => {
    const worker = new FakeWorker(undefined);
    const controller = createPackageWorkerProcessTreeController("win32", {
      PI67_WINDOWS_JOB_CONTROLLER: "C:\\Pi-67\\pi67-package-worker-job.exe",
      SystemRoot: "C:\\Windows"
    });

    await expect(controller.inspect(worker.asChildProcess(), "win32", 20)).resolves.toBe(false);
    await controller.dispose();
  });

  it("fails closed after the Windows controller pipe becomes unusable", async () => {
    const worker = new FakeWorker(713);
    const helper = new FakeJobController();
    const controller = createPackageWorkerProcessTreeController("win32", {
      PI67_WINDOWS_JOB_CONTROLLER: "C:\\Pi-67\\pi67-package-worker-job.exe",
      SystemRoot: "C:\\Windows"
    }, (() => helper.asChildProcess()) as never);

    const attached = controller.attach(worker.asChildProcess());
    helper.message({ type: "ready", activeProcesses: 1 });
    await attached;
    helper.stdin.emit("error", new Error("EPIPE"));

    await expect(controller.inspect(worker.asChildProcess(), "win32", 250)).rejects.toMatchObject({
      code: "RUNTIME_POISONED",
      details: { processTreeCleanup: false, jobControllerOperation: "write-failed" }
    });
    const disposed = controller.dispose();
    helper.exit(0);
    await disposed;
  });

  it("retains the bounded native operation and Win32 code", async () => {
    const worker = new FakeWorker(714);
    const helper = new FakeJobController();
    const controller = createPackageWorkerProcessTreeController("win32", {
      PI67_WINDOWS_JOB_CONTROLLER: "C:\\Pi-67\\pi67-package-worker-job.exe",
      SystemRoot: "C:\\Windows"
    }, (() => helper.asChildProcess()) as never);

    const attached = controller.attach(worker.asChildProcess());
    helper.message({ type: "error", operation: "assign-process", code: 5 });
    await expect(attached).rejects.toMatchObject({
      code: "TOOLCHAIN_INTEGRITY_FAILED",
      details: {
        containmentEstablished: false,
        requestDispatched: false,
        jobControllerOperation: "assign-process",
        jobControllerCode: 5
      }
    });
    const disposed = controller.dispose();
    helper.exit(70);
    await disposed;
  });

  it("fails closed when the Job controller never reports attachment readiness", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker(715);
    const helper = new FakeJobController();
    const controller = createPackageWorkerProcessTreeController("win32", {
      PI67_WINDOWS_JOB_CONTROLLER: "C:\\Pi-67\\pi67-package-worker-job.exe",
      SystemRoot: "C:\\Windows"
    }, (() => helper.asChildProcess()) as never);

    const attached = controller.attach(worker.asChildProcess());
    const rejected = expect(attached).rejects.toMatchObject({
      code: "TOOLCHAIN_INTEGRITY_FAILED",
      details: {
        containmentEstablished: false,
        requestDispatched: false,
        jobControllerOperation: "timeout"
      }
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;
    const disposed = controller.dispose();
    helper.exit(0);
    await disposed;
  });

  it("fails closed when the Job controller exits before readiness", async () => {
    const worker = new FakeWorker(716);
    const helper = new FakeJobController();
    const controller = createPackageWorkerProcessTreeController("win32", {
      PI67_WINDOWS_JOB_CONTROLLER: "C:\\Pi-67\\pi67-package-worker-job.exe",
      SystemRoot: "C:\\Windows"
    }, (() => helper.asChildProcess()) as never);

    const attached = controller.attach(worker.asChildProcess());
    helper.exit(70);
    await expect(attached).rejects.toMatchObject({
      code: "TOOLCHAIN_INTEGRITY_FAILED",
      details: {
        containmentEstablished: false,
        requestDispatched: false,
        jobControllerOperation: "failed"
      }
    });
    await controller.dispose();
  });
});

class FakeWorker extends EventEmitter {
  readonly pid: number | undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  connected = true;
  readonly disconnect = vi.fn(() => { this.connected = false; });
  readonly kill = vi.fn(() => true);

  constructor(pid: number | undefined) {
    super();
    this.pid = pid;
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

class FakeJobController extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly commands: string[] = [];
  readonly stdin = Object.assign(new EventEmitter(), {
    writable: true,
    write: vi.fn((value: string) => {
      this.commands.push(value);
      return true;
    })
  });
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn(() => {
    this.exit(null, "SIGTERM");
    return true;
  });

  message(value: unknown): void {
    queueMicrotask(() => this.stdout.emit("data", Buffer.from(`${JSON.stringify(value)}\n`)));
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

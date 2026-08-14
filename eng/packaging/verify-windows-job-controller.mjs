import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const fixtureRootArgument = "--fixture-root";
const fixtureDescendantArgument = "--fixture-descendant";
const operationTimeoutMs = 5_000;

export async function verifyWindowsJobController(
  platform = process.platform,
  architecture = process.arch,
  executable,
  spawnProcess = spawn
) {
  if (platform !== "win32") return { status: "not-required" };
  if (architecture !== "x64") {
    throw new Error(`Windows Package Worker Job controller smoke does not support ${platform}/${architecture}.`);
  }
  if (typeof executable !== "string" || executable.length === 0) {
    throw new Error("Windows Package Worker Job controller smoke requires an executable path.");
  }

  await verifyContainmentScenario(executable, "terminate", spawnProcess);
  await verifyContainmentScenario(executable, "close", spawnProcess);
  console.log("Windows Package Worker Job controller smoke passed: descendant termination and kill-on-close.");
  return { status: "verified" };
}

async function verifyContainmentScenario(executable, mode, spawnProcess) {
  let descendantPid;
  const root = spawnProcess(process.execPath, [currentFile, fixtureRootArgument], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true
  });
  const rootExit = processExit(root);
  let controller;
  let controllerExit;
  try {
    const fixtureReady = await nextFixtureMessage(root, operationTimeoutMs);
    if (fixtureReady.type !== "fixture-ready" || root.pid === undefined) {
      throw new Error("Windows Job controller root fixture did not start correctly.");
    }

    controller = spawnProcess(executable, ["--pid", String(root.pid)], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true
    });
    controllerExit = processExit(controller);
    const channel = new JobControllerChannel(controller);
    const ready = await channel.next(operationTimeoutMs);
    if (ready.type !== "ready" || ready.activeProcesses !== 1) {
      throw new Error("Windows Job controller did not report one contained root process.");
    }

    const fixtureSpawnedMessage = nextFixtureMessage(root, operationTimeoutMs);
    root.send?.({ type: "spawn-descendant" });
    const fixtureSpawned = await fixtureSpawnedMessage;
    if (fixtureSpawned.type !== "descendant-ready") {
      throw new Error("Windows Job controller descendant fixture did not start correctly.");
    }
    descendantPid = fixtureSpawned.pid;

    const inspected = await channel.command("inspect", operationTimeoutMs);
    if (inspected.type !== "status" || inspected.activeProcesses < 2) {
      throw new Error("Windows Job controller did not contain the fixture descendant.");
    }

    if (mode === "terminate") {
      const terminated = await channel.command("terminate", operationTimeoutMs);
      if (terminated.type !== "terminated" || terminated.activeProcesses !== 0) {
        throw new Error("Windows Job controller did not prove forced process-tree termination.");
      }
      await Promise.all([
        withTimeout(rootExit, operationTimeoutMs, "Windows Job root fixture did not exit after termination."),
        waitForProcessGone(descendantPid, operationTimeoutMs)
      ]);
      const closing = await channel.command("close", operationTimeoutMs);
      if (closing.type !== "closing" || closing.activeProcesses !== 0) {
        throw new Error("Windows Job controller did not close from an empty Job.");
      }
    } else {
      const closing = await channel.command("close", operationTimeoutMs);
      if (closing.type !== "closing" || closing.activeProcesses < 2) {
        throw new Error("Windows Job controller kill-on-close fixture lost containment state.");
      }
      await Promise.all([
        withTimeout(rootExit, operationTimeoutMs, "Windows Job root fixture survived Job handle closure."),
        waitForProcessGone(descendantPid, operationTimeoutMs)
      ]);
    }
    await withTimeout(
      controllerExit,
      operationTimeoutMs,
      "Windows Job controller did not exit after close."
    );
  } finally {
    await stopFixture(controller, controllerExit, root, rootExit, descendantPid);
  }
}

class JobControllerChannel {
  #controller;
  #buffer = "";
  #messages = [];
  #waiter;
  #failure;

  constructor(controller) {
    this.#controller = controller;
    controller.stdout?.on("data", (chunk) => this.#capture(chunk));
    controller.stdout?.on("error", () => this.#fail(new Error("Windows Job controller stdout failed.")));
    controller.stdin?.on("error", () => this.#fail(new Error("Windows Job controller stdin failed.")));
    controller.once("error", (error) => this.#fail(error));
    controller.once("exit", (code, signal) => {
      this.#fail(new Error(`Windows Job controller exited unexpectedly (${signal ?? code}).`));
    });
  }

  command(command, timeoutMs) {
    if (!this.#controller.stdin?.writable) {
      return Promise.reject(new Error("Windows Job controller stdin is closed."));
    }
    const response = this.next(timeoutMs);
    try {
      this.#controller.stdin.write(`${command}\n`);
    } catch (error) {
      this.#fail(error);
    }
    return response;
  }

  next(timeoutMs) {
    if (this.#failure) return Promise.reject(this.#failure);
    const queued = this.#messages.shift();
    if (queued) return Promise.resolve(queued);
    if (this.#waiter) return Promise.reject(new Error("Windows Job controller command overlap."));
    return new Promise((resolvePromise, reject) => {
      const waiter = {
        resolve: (message) => {
          clearTimeout(timer);
          resolvePromise(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        if (this.#waiter !== waiter) return;
        this.#waiter = undefined;
        reject(new Error("Windows Job controller response timed out."));
      }, timeoutMs);
      this.#waiter = waiter;
    });
  }

  #capture(chunk) {
    if (this.#failure) return;
    this.#buffer += chunk.toString("utf8");
    if (this.#buffer.length > 4_096) {
      this.#fail(new Error("Windows Job controller smoke output exceeded its byte limit."));
      return;
    }
    let lineEnd = this.#buffer.indexOf("\n");
    while (lineEnd >= 0) {
      const line = this.#buffer.slice(0, lineEnd).trim();
      this.#buffer = this.#buffer.slice(lineEnd + 1);
      if (line.length > 0) {
        let message;
        try {
          message = parseWindowsJobControllerSmokeMessage(line);
        } catch (error) {
          this.#fail(error);
          return;
        }
        if (!message) {
          this.#fail(new Error("Windows Job controller emitted invalid smoke output."));
          return;
        }
        if (this.#waiter) {
          const waiter = this.#waiter;
          this.#waiter = undefined;
          waiter.resolve(message);
        } else if (this.#messages.length === 0) {
          this.#messages.push(message);
        } else {
          this.#fail(new Error("Windows Job controller emitted unexpected smoke output."));
          return;
        }
      }
      lineEnd = this.#buffer.indexOf("\n");
    }
  }

  #fail(error) {
    this.#failure ??= error;
    this.#waiter?.reject(this.#failure);
    this.#waiter = undefined;
  }
}

export function parseWindowsJobControllerSmokeMessage(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  if (parsed.type === "error") {
    throw new Error(`Windows Job controller native operation failed: ${String(parsed.operation).slice(0, 64)} (${parsed.code}).`);
  }
  if (
    !["ready", "status", "terminated", "closing"].includes(parsed.type)
    || !Number.isSafeInteger(parsed.activeProcesses)
    || parsed.activeProcesses < 0
  ) return undefined;
  return { type: parsed.type, activeProcesses: parsed.activeProcesses };
}

function nextFixtureMessage(child, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const finish = (operation) => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      operation();
    };
    const onMessage = (message) => finish(() => resolvePromise(message));
    const onError = (error) => finish(() => reject(error));
    const onExit = (code, signal) => finish(() => reject(new Error(
      `Windows Job root fixture exited before responding (${signal ?? code}).`
    )));
    const timer = setTimeout(() => finish(() => reject(new Error(
      "Windows Job root fixture response timed out."
    ))), timeoutMs);
    child.once("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function processExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    child.once("error", () => resolvePromise());
    child.once("exit", () => resolvePromise());
  });
}

async function waitForProcessGone(pid, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) return;
    await delay(25);
  }
  throw new Error("Windows Job descendant fixture survived process-tree cleanup.");
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

async function stopFixture(controller, controllerExit, root, rootExit, descendantPid) {
  if (controller && controller.exitCode === null && controller.signalCode === null) {
    try {
      controller.stdin?.write("close\n");
    } catch {
      // Terminating the controller also closes the owned Job handle.
    }
    if (!await settlesWithin(controllerExit, 500)) controller.kill();
  }
  if (root.exitCode === null && root.signalCode === null) root.kill();
  if (descendantPid !== undefined && isProcessAlive(descendantPid)) {
    try {
      process.kill(descendantPid, "SIGKILL");
    } catch {
      // The Job close or root cleanup may have already won the race.
    }
  }
  await settlesWithin(rootExit, 500);
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function settlesWithin(promise, timeoutMs) {
  if (!promise) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    void promise.then(() => finish(true), () => finish(true));
  });
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function runRootFixture() {
  process.send?.({ type: "fixture-ready" });
  await new Promise(() => {
    process.once("message", (message) => {
      if (message?.type !== "spawn-descendant") process.exit(64);
      const descendant = spawn(process.execPath, [currentFile, fixtureDescendantArgument], {
        stdio: "ignore",
        windowsHide: true
      });
      descendant.once("error", () => process.exit(70));
      if (descendant.pid === undefined) process.exit(70);
      process.send?.({ type: "descendant-ready", pid: descendant.pid });
      setInterval(() => undefined, 1_000);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  if (process.argv[2] === fixtureRootArgument) await runRootFixture();
  else if (process.argv[2] === fixtureDescendantArgument) await new Promise(() => {
    setInterval(() => undefined, 1_000);
  });
  else await verifyWindowsJobController(process.platform, process.arch, process.argv[2]);
}

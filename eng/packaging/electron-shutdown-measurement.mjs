import { isProcessAlive } from "./controlled-shutdown-fixture.ts";

const DEFAULT_PROCESS_POLL_INTERVAL_MS = 50;
const DEFAULT_DRIVER_CLOSE_TIMEOUT_MS = 15_000;
const DEFAULT_FORCED_TERMINATION_GRACE_MS = 2_000;

export async function measureElectronApplicationShutdown({
  application,
  budgetMs,
  childPid,
  driverCloseTimeoutMs = DEFAULT_DRIVER_CLOSE_TIMEOUT_MS,
  forcedTerminationGraceMs = DEFAULT_FORCED_TERMINATION_GRACE_MS,
  mainPid,
  now = () => performance.now(),
  pollIntervalMs = DEFAULT_PROCESS_POLL_INTERVAL_MS,
  processAlive = isProcessAlive,
  terminateProcess = (pid) => process.kill(pid),
  utilityPids
}) {
  const startedAt = now();
  const main = trackedProcess(mainPid, processAlive);
  const utilities = utilityPids
    .map((pid) => trackedProcess(pid, processAlive))
    .filter(Boolean);
  const controlledChild = trackedProcess(childPid, processAlive);
  const tracked = [main, ...utilities, controlledChild].filter(Boolean);
  const sample = () => {
    const elapsedMs = round(now() - startedAt);
    for (const state of tracked) {
      state.aliveAfterClose = processAlive(state.pid);
      if (!state.aliveAfterClose && state.exitObservedMs === null) {
        state.exitObservedMs = elapsedMs;
      }
    }
  };
  const timer = setInterval(sample, pollIntervalMs);
  timer.unref?.();
  let driverCloseDurationMs;
  let driverCloseError;
  let driverCloseTimedOut = false;
  let forcedTerminationRequested = false;
  try {
    const closeResult = await closeElectronApplicationWithinTimeout({
      application,
      forcedTerminationGraceMs,
      mainPid,
      now,
      processAlive,
      terminateProcess,
      timeoutMs: driverCloseTimeoutMs
    });
    driverCloseDurationMs = closeResult.durationMs;
    driverCloseError = closeResult.error;
    driverCloseTimedOut = closeResult.timedOut;
    forcedTerminationRequested = closeResult.forcedTerminationRequested;
    sample();
    while (tracked.some((state) => state.aliveAfterClose)) {
      const remainingMs = budgetMs - (now() - startedAt);
      if (remainingMs <= 0) break;
      await delay(Math.min(pollIntervalMs, remainingMs));
      sample();
    }
  } finally {
    clearInterval(timer);
    sample();
  }

  const processes = {
    controlledChild: summarizeTrackedProcess(controlledChild),
    main: summarizeTrackedProcess(main, true),
    utilities: summarizeUtilityProcesses(utilities)
  };
  return {
    driverCloseDurationMs,
    driverCloseError,
    driverCloseTimedOut,
    forcedTerminationRequested,
    processes,
    productExitDurationMs: productExitDuration({
      childExpected: childPid !== undefined,
      controlledChild,
      main,
      utilities
    })
  };
}

export function productShutdownWithinBudget(measurement, budgetMs) {
  return measurement.driverCloseError === undefined
    && measurement.driverCloseTimedOut === false
    && measurement.productExitDurationMs !== null
    && measurement.productExitDurationMs <= budgetMs;
}

export async function closeElectronApplicationWithinTimeout({
  application,
  forcedTerminationGraceMs = DEFAULT_FORCED_TERMINATION_GRACE_MS,
  mainPid = application.process().pid,
  now = () => performance.now(),
  processAlive = isProcessAlive,
  terminateProcess = (pid) => process.kill(pid),
  timeoutMs = DEFAULT_DRIVER_CLOSE_TIMEOUT_MS
}) {
  assertPositiveTimeout(timeoutMs, "Electron driver close timeout");
  assertPositiveTimeout(forcedTerminationGraceMs, "Electron forced-termination grace");
  const startedAt = now();
  const close = Promise.resolve()
    .then(() => application.close())
    .then(
      () => ({ status: "closed" }),
      (error) => ({ error: describeError(error), status: "failed" })
    );
  const initialResult = await settleWithin(close, timeoutMs);
  if (initialResult.settled) {
    return {
      durationMs: now() - startedAt,
      error: initialResult.value.status === "failed" ? initialResult.value.error : undefined,
      forcedTerminationRequested: false,
      mainAliveAfterClose: processAlive(mainPid),
      timedOut: false
    };
  }

  let terminationError;
  let forcedTerminationRequested = false;
  if (processAlive(mainPid)) {
    forcedTerminationRequested = true;
    try {
      terminateProcess(mainPid);
    } catch (error) {
      terminationError = describeError(error);
    }
  }
  const forcedResult = await settleWithin(close, forcedTerminationGraceMs);
  return {
    durationMs: now() - startedAt,
    error: forcedResult.settled && forcedResult.value.status === "failed"
      ? forcedResult.value.error
      : terminationError,
    forcedTerminationRequested,
    mainAliveAfterClose: processAlive(mainPid),
    timedOut: true
  };
}

function productExitDuration({ childExpected, controlledChild, main, utilities }) {
  const required = [main, ...utilities, ...(childExpected ? [controlledChild] : [])];
  if (required.some((state) => (
    !state
    || !state.aliveBeforeClose
    || state.aliveAfterClose
    || state.exitObservedMs === null
  ))) return null;
  return Math.max(...required.map((state) => state.exitObservedMs));
}

function trackedProcess(pid, processAlive) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  const alive = processAlive(pid);
  return {
    aliveAfterClose: alive,
    aliveBeforeClose: alive,
    exitObservedMs: alive ? null : 0,
    pid
  };
}

function summarizeTrackedProcess(state, includeProcessId = false) {
  if (!state) {
    return {
      aliveAfterClose: false,
      aliveBeforeClose: false,
      exitObservedMs: null,
      present: false,
      ...(includeProcessId ? { processId: null } : {})
    };
  }
  return {
    aliveAfterClose: state.aliveAfterClose,
    aliveBeforeClose: state.aliveBeforeClose,
    exitObservedMs: state.exitObservedMs,
    present: true,
    ...(includeProcessId ? { processId: state.pid } : {})
  };
}

function summarizeUtilityProcesses(states) {
  const observedExitTimes = states
    .map((state) => state.exitObservedMs)
    .filter((value) => value !== null);
  return {
    aliveAfterCloseCount: states.filter((state) => state.aliveAfterClose).length,
    aliveBeforeCloseCount: states.filter((state) => state.aliveBeforeClose).length,
    count: states.length,
    firstExitObservedMs: observedExitTimes.length > 0 ? Math.min(...observedExitTimes) : null,
    lastExitObservedMs: observedExitTimes.length > 0 ? Math.max(...observedExitTimes) : null,
    observedExitCount: observedExitTimes.length
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function settleWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ settled: false });
    }, timeoutMs);
    promise.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ settled: true, value });
    });
  });
}

function assertPositiveTimeout(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

import { isProcessAlive } from "./controlled-shutdown-fixture.ts";

const DEFAULT_PROCESS_POLL_INTERVAL_MS = 50;

export async function measureElectronApplicationShutdown({
  application,
  budgetMs,
  childPid,
  mainPid,
  now = () => performance.now(),
  pollIntervalMs = DEFAULT_PROCESS_POLL_INTERVAL_MS,
  processAlive = isProcessAlive,
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
  try {
    await application.close();
    driverCloseDurationMs = now() - startedAt;
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
  return measurement.productExitDurationMs !== null
    && measurement.productExitDurationMs <= budgetMs;
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

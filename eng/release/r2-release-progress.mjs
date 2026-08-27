const defaultHeartbeatIntervalMs = 15_000;
const defaultProgressIntervalMs = 5_000;
const byteProgressThreshold = 16 * 1024 * 1024;

export function createR2ReleaseProgressReporter({
  write = (line) => process.stderr.write(line),
  now = Date.now,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  heartbeatIntervalMs = defaultHeartbeatIntervalMs,
  progressIntervalMs = defaultProgressIntervalMs
} = {}) {
  const startedAt = now();
  const stages = new Map();
  const transfers = new Map();
  let activeStage;
  let closed = false;
  let lastOutputAt = startedAt;

  const heartbeat = setIntervalImpl(() => {
    if (closed || now() - lastOutputAt < heartbeatIntervalMs) return;
    const activeTransfer = [...transfers.values()].find((entry) => entry.status === "active");
    if (activeTransfer) {
      emitTransfer(activeTransfer, "alive");
      return;
    }
    if (activeStage) emit(`[R2 ${formatDuration(now() - startedAt)}] ${activeStage} alive`);
  }, Math.min(heartbeatIntervalMs, 1_000));
  heartbeat?.unref?.();

  function stage(event) {
    assertOpen();
    const timestamp = now();
    if (event.phase === "start") {
      const entry = {
        name: event.name,
        detail: event.detail,
        manifestState: event.manifestState,
        startedAt: timestamp,
        status: "active"
      };
      stages.set(event.name, entry);
      activeStage = event.name;
      emitStage(entry, "start");
      return;
    }
    const entry = stages.get(event.name);
    if (!entry || entry.status !== "active") {
      throw new Error(`R2 progress stage ${event.name} is not active.`);
    }
    entry.completedAt = timestamp;
    entry.status = event.phase === "failed" ? "failed" : "complete";
    entry.detail = event.detail ?? entry.detail;
    entry.manifestState = event.manifestState ?? entry.manifestState;
    emitStage(entry, entry.status);
    if (activeStage === event.name) activeStage = undefined;
  }

  function transfer(event) {
    assertOpen();
    const key = `${event.operation}:${event.name}`;
    const timestamp = now();
    if (event.phase === "start") {
      const entry = {
        operation: event.operation,
        name: event.name,
        totalBytes: event.totalBytes,
        transferredBytes: event.transferredBytes ?? 0,
        startedAt: timestamp,
        lastProgressAt: timestamp,
        lastOutputBytes: 0,
        lastOutputAt: timestamp,
        status: "active"
      };
      transfers.set(key, entry);
      emitTransfer(entry, "start");
      return;
    }
    const entry = transfers.get(key);
    if (!entry || entry.status !== "active") {
      throw new Error(`R2 transfer ${key} is not active.`);
    }
    if (event.transferredBytes < entry.transferredBytes) {
      throw new Error(`R2 transfer ${key} moved backwards.`);
    }
    entry.transferredBytes = event.transferredBytes;
    entry.lastProgressAt = timestamp;
    if (event.totalBytes !== undefined) entry.totalBytes = event.totalBytes;
    if (event.phase === "complete" || event.phase === "failed") {
      entry.completedAt = timestamp;
      entry.status = event.phase;
      emitTransfer(entry, event.phase);
      return;
    }
    if (
      timestamp - entry.lastOutputAt >= progressIntervalMs
      || entry.transferredBytes - entry.lastOutputBytes >= byteProgressThreshold
    ) {
      emitTransfer(entry, "progress");
    }
  }

  function finish() {
    assertOpen();
    closed = true;
    clearIntervalImpl(heartbeat);
    const completedAt = now();
    return {
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      elapsedMs: completedAt - startedAt,
      stages: [...stages.values()].map((entry) => ({
        name: entry.name,
        status: entry.status,
        elapsedMs: (entry.completedAt ?? completedAt) - entry.startedAt,
        ...(entry.manifestState ? { manifestState: entry.manifestState } : {})
      })),
      transfers: [...transfers.values()].map((entry) => ({
        operation: entry.operation,
        name: entry.name,
        status: entry.status,
        transferredBytes: entry.transferredBytes,
        totalBytes: entry.totalBytes,
        elapsedMs: (entry.completedAt ?? completedAt) - entry.startedAt,
        averageBytesPerSecond: averageRate(entry, completedAt)
      }))
    };
  }

  function fail(error) {
    if (closed) return;
    const message = error instanceof Error ? error.message : String(error);
    emit(`[R2 ${formatDuration(now() - startedAt)}] FAILED - ${message}`);
  }

  function emitStage(entry, phase) {
    const manifest = entry.manifestState ? ` | manifest ${entry.manifestState}` : "";
    const detail = entry.detail ? ` - ${entry.detail}` : "";
    emit(`[R2 ${formatDuration(now() - startedAt)}] ${entry.name} ${phase}${detail}${manifest}`);
  }

  function emitTransfer(entry, phase) {
    const timestamp = now();
    const rate = averageRate(entry, timestamp);
    const transferred = formatBytes(entry.transferredBytes);
    const total = Number.isSafeInteger(entry.totalBytes) && entry.totalBytes >= 0
      ? ` / ${formatBytes(entry.totalBytes)}`
      : "";
    const percent = entry.totalBytes > 0
      ? ` (${Math.min(100, (entry.transferredBytes / entry.totalBytes) * 100).toFixed(1)}%)`
      : "";
    const rateText = rate > 0 ? ` | ${formatBytes(rate)}/s` : "";
    const remaining = entry.totalBytes - entry.transferredBytes;
    const eta = rate > 0 && remaining > 0 ? ` | ETA ${formatDuration((remaining / rate) * 1000)}` : "";
    const manifestState = activeStage ? stages.get(activeStage)?.manifestState : undefined;
    const manifest = manifestState ? ` | manifest ${manifestState}` : "";
    emit(
      `[R2 ${formatDuration(timestamp - startedAt)}] ${entry.operation} ${phase} ${entry.name}`
      + ` | ${transferred}${total}${percent}${rateText}${eta}${manifest}`
    );
    entry.lastOutputAt = timestamp;
    entry.lastOutputBytes = entry.transferredBytes;
  }

  function emit(line) {
    write(`${line}\n`);
    lastOutputAt = now();
  }

  function assertOpen() {
    if (closed) throw new Error("R2 progress reporter is already closed.");
  }

  return { fail, finish, stage, transfer };
}

export const silentR2ReleaseProgress = Object.freeze({
  stage() {},
  transfer() {}
});

function averageRate(entry, timestamp) {
  const elapsedMs = (entry.completedAt ?? timestamp) - entry.startedAt;
  return elapsedMs > 0 ? Math.round(entry.transferredBytes * 1000 / elapsedMs) : 0;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

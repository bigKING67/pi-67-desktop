export const REAL_USER_MODEL_RUNTIME_TIMEOUT_MS = 5_000;

const INITIALIZATION_STAGES = new Set([
  "resolve-session",
  "dispose-current",
  "create-session",
  "load-model-runtime",
  "reload-configuration",
  "project-snapshot"
]);

export function parseInitializationObservations(output) {
  return output.split(/\r?\n/u).flatMap((line) => {
    if (!line.startsWith("[agent-host:init] ")) return [];
    try {
      const observation = JSON.parse(line.slice("[agent-host:init] ".length));
      return INITIALIZATION_STAGES.has(observation.stage)
        && ["started", "completed", "failed"].includes(observation.outcome)
        && Number.isFinite(observation.durationMs)
        ? [{
            durationMs: Math.max(0, Math.round(observation.durationMs)),
            outcome: observation.outcome,
            stage: observation.stage
          }]
        : [];
    } catch {
      return [];
    }
  });
}

export function assertModelRuntimeInitialization(observations) {
  const relevant = observations.filter((observation) => observation.stage === "load-model-runtime");
  const started = relevant.filter((observation) => observation.outcome === "started");
  const completed = relevant.filter((observation) => observation.outcome === "completed");
  const failed = relevant.filter((observation) => observation.outcome === "failed");
  if (started.length === 0) {
    throw new Error("Windows real-user lifecycle did not observe Pi Provider ModelRuntime startup.");
  }
  if (failed.length > 0 || completed.length !== started.length) {
    throw new Error("Windows real-user Pi Provider ModelRuntime startup did not complete cleanly.");
  }
  const maxDurationMs = Math.max(...completed.map((observation) => observation.durationMs));
  if (maxDurationMs > REAL_USER_MODEL_RUNTIME_TIMEOUT_MS) {
    throw new Error(
      `Windows real-user Pi Provider ModelRuntime startup exceeded ${REAL_USER_MODEL_RUNTIME_TIMEOUT_MS}ms.`
    );
  }
  return {
    attemptCount: started.length,
    maxDurationMs
  };
}

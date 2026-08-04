export const WINDOWS_NATIVE_JOB_NAME = "Native smoke / Windows x64";
export const WINDOWS_INSTALLER_LIFECYCLE_STEP_NAME = "Verify Windows NSIS installer lifecycle";

export function windowsInstallerCandidateName(runId) {
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    throw new Error("Windows installer source run ID must be a positive integer.");
  }
  return `windows-installer-debug-candidate-${runId}`;
}

export function verifySourceRunMetadata(metadata, sourceSha) {
  if (
    metadata?.head_sha !== sourceSha
    || metadata?.status !== "completed"
    || metadata?.conclusion !== "failure"
    || metadata?.path !== ".github/workflows/ci.yml"
    || metadata?.run_attempt !== 1
  ) throw new Error("Source run is not a completed failed CI run for the requested SHA.");
}

export function verifySourceRunJobsMetadata(metadata) {
  const jobs = Array.isArray(metadata?.jobs) ? metadata.jobs : [];
  const windowsJobs = jobs.filter((job) => job?.name === WINDOWS_NATIVE_JOB_NAME);
  if (windowsJobs.length !== 1) {
    throw new Error("Source run did not expose exactly one latest Windows native job.");
  }

  const job = windowsJobs[0];
  if (job.status !== "completed" || job.conclusion !== "failure") {
    throw new Error("Source Windows native job was not a completed failure.");
  }

  const steps = Array.isArray(job.steps) ? job.steps : [];
  const lifecycleSteps = steps.filter((step) => step?.name === WINDOWS_INSTALLER_LIFECYCLE_STEP_NAME);
  if (lifecycleSteps.length !== 1 || lifecycleSteps[0].conclusion !== "failure") {
    throw new Error("Source Windows native job did not fail at the installer lifecycle step.");
  }

  const lifecycleStep = lifecycleSteps[0];
  if (!Number.isSafeInteger(lifecycleStep.number) || lifecycleStep.number <= 0) {
    throw new Error("Source installer lifecycle step did not expose a valid step number.");
  }
  const invalidPredecessor = steps.find((step) => (
    Number.isSafeInteger(step?.number)
    && step.number < lifecycleStep.number
    && step.conclusion !== "success"
  ));
  if (invalidPredecessor) {
    throw new Error(
      `Source Windows native prerequisite did not succeed: ${invalidPredecessor.name} (${invalidPredecessor.conclusion}).`
    );
  }
}

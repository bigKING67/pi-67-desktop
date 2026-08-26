export const WINDOWS_NATIVE_JOB_NAME = "Native smoke / Windows x64";
export const WINDOWS_INSTALLER_LIFECYCLE_STEP_NAME = "Verify Windows NSIS installer lifecycle";
export const WINDOWS_PACKAGED_UI_STEP_NAME = "Verify Windows packaged synthetic scale and IME contracts";

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

export function verifySourceRunJobsMetadata(metadata, { allowPackagedUiFailure = false } = {}) {
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
  if (lifecycleSteps.length !== 1) {
    throw new Error("Source Windows native job did not expose exactly one installer lifecycle step.");
  }
  const lifecycleStep = lifecycleSteps[0];
  if (lifecycleStep.conclusion === "failure") {
    verifySuccessfulPredecessors(steps, lifecycleStep);
    return;
  }
  if (!allowPackagedUiFailure) {
    throw new Error("Source Windows native job did not fail at the installer lifecycle step.");
  }

  const packagedUiSteps = steps.filter((step) => step?.name === WINDOWS_PACKAGED_UI_STEP_NAME);
  if (
    packagedUiSteps.length !== 1
    || packagedUiSteps[0].conclusion !== "failure"
    || lifecycleStep.conclusion !== "skipped"
  ) {
    throw new Error("Source Windows native job did not expose a reusable packaged UI failure.");
  }
  verifySuccessfulPredecessors(steps, packagedUiSteps[0]);
}

export function verifyWindowsCandidateSourceRunMetadata(metadata, sourceSha, runAttempt) {
  if (
    metadata?.head_sha !== sourceSha
    || metadata?.status !== "completed"
    || metadata?.conclusion !== "failure"
    || metadata?.path !== ".github/workflows/windows-candidate.yml"
    || metadata?.run_attempt !== runAttempt
  ) throw new Error("Source run is not the requested completed failed Windows Candidate run.");
}

export function verifyWindowsCandidateSourceRunJobsMetadata(metadata) {
  const jobs = Array.isArray(metadata?.jobs) ? metadata.jobs : [];
  const expectedJobs = new Map([
    ["provenance", "success"],
    ["build-windows", "success"],
    ["certify-installer", "failure"]
  ]);
  for (const [name, conclusion] of expectedJobs) {
    const matches = jobs.filter((job) => job?.name === name);
    if (
      matches.length !== 1
      || matches[0].status !== "completed"
      || matches[0].conclusion !== conclusion
    ) {
      throw new Error(`Windows Candidate source job ${name} did not complete with ${conclusion}.`);
    }
  }

  const certificationJob = jobs.find((job) => job?.name === "certify-installer");
  const steps = Array.isArray(certificationJob?.steps) ? certificationJob.steps : [];
  const lifecycleSteps = steps.filter((step) => step?.name === "Verify full Windows NSIS installer lifecycle");
  if (lifecycleSteps.length !== 1 || lifecycleSteps[0].conclusion !== "failure") {
    throw new Error("Windows Candidate source run did not fail at the installer lifecycle step.");
  }
  verifySuccessfulPredecessors(steps, lifecycleSteps[0]);
}

function verifySuccessfulPredecessors(steps, failureStep) {
  if (!Number.isSafeInteger(failureStep.number) || failureStep.number <= 0) {
    throw new Error("Source Windows native failure step did not expose a valid step number.");
  }
  const invalidPredecessor = steps.find((step) => (
    Number.isSafeInteger(step?.number)
    && step.number < failureStep.number
    && step.conclusion !== "success"
  ));
  if (invalidPredecessor) {
    throw new Error(
      `Source Windows native prerequisite did not succeed: ${invalidPredecessor.name} (${invalidPredecessor.conclusion}).`
    );
  }
}

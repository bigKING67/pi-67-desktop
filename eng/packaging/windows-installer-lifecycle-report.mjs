import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./packaged-electron-fixture.mjs";

export const outputDirectory = join(repositoryRoot, "artifacts/validation/windows-installer-lifecycle");
export const summaryPath = join(outputDirectory, "summary.json");

export async function timedPhase(name, action) {
  const startedAt = performance.now();
  await action();
  return { durationMs: round(performance.now() - startedAt), name };
}

export async function writeReport(report, destination = summaryPath) {
  const staging = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(staging, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(staging, destination);
  } finally {
    await rm(staging, { force: true });
  }
}

export async function recordProgress(report, stage, completedLaunch, destination = summaryPath) {
  report.progress = { stage, observedAt: new Date().toISOString() };
  if (completedLaunch) (report.completedLaunches ??= []).push({ stage, result: completedLaunch });
  await writeReport(report, destination);
  console.log(`Windows installer lifecycle: ${stage}`);
}

export async function recordPhase(report, phase, destination = summaryPath) {
  report.phases.push(phase);
  await recordProgress(report, `${phase.name}:completed`, undefined, destination);
}

export function boundedErrorMessage(error, privateRoot) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(privateRoot, "<temporary-root>").slice(0, 2_000);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

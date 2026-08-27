import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot } from "./packaged-electron-fixture.mjs";

export const outputDirectory = join(repositoryRoot, "artifacts/validation/windows-installer-lifecycle");
export const summaryPath = join(outputDirectory, "summary.json");

export async function timedPhase(name, action) {
  const startedAt = performance.now();
  await action();
  return { durationMs: round(performance.now() - startedAt), name };
}

export async function writeReport(report) {
  await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function boundedErrorMessage(error, privateRoot) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(privateRoot, "<temporary-root>").slice(0, 2_000);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

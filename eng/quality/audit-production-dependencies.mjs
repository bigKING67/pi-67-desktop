import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const reportPath = join(root, "artifacts/quality/production-dependency-audit.json");

export function productionDependencyAuditReport(audit, exitCode, generatedAt = new Date().toISOString()) {
  const vulnerabilities = audit?.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") {
    throw new Error("pnpm audit did not return vulnerability metadata");
  }
  const counts = Object.fromEntries(
    ["info", "low", "moderate", "high", "critical"].map((severity) => {
      const value = vulnerabilities[severity];
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`pnpm audit returned an invalid ${severity} vulnerability count`);
      }
      return [severity, value];
    })
  );
  return {
    schema: "pi67.production-dependency-audit.v1",
    generatedAt,
    command: ["corepack", "pnpm", "audit", "--prod", "--audit-level", "high", "--json"],
    exitCode,
    passed: exitCode === 0 && counts.high === 0 && counts.critical === 0,
    vulnerabilities: counts,
    dependencies: audit.metadata.dependencies,
    optionalDependencies: audit.metadata.optionalDependencies,
    totalDependencies: audit.metadata.totalDependencies,
    advisories: audit.advisories ?? {}
  };
}

async function main() {
  const executable = process.platform === "win32" ? "corepack.cmd" : "corepack";
  const result = spawnSync(executable, [
    "pnpm", "audit", "--prod", "--audit-level", "high", "--json"
  ], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });
  let report;
  try {
    if (result.error) throw result.error;
    report = productionDependencyAuditReport(
      JSON.parse(result.stdout || ""),
      Number.isSafeInteger(result.status) ? result.status : 1
    );
  } catch (error) {
    report = {
      schema: "pi67.production-dependency-audit.v1",
      generatedAt: new Date().toISOString(),
      command: ["corepack", "pnpm", "audit", "--prod", "--audit-level", "high", "--json"],
      exitCode: Number.isSafeInteger(result.status) ? result.status : 1,
      passed: false,
      error: boundedError(error)
    };
  }
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (!report.passed) {
    console.error(`Production dependency audit failed. Report: ${reportPath}`);
    process.exitCode = 1;
    return;
  }
  const counts = report.vulnerabilities;
  console.log(
    `Production dependency audit passed: ${counts.high} high, ${counts.critical} critical. Report: ${reportPath}`
  );
}

function boundedError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(root, "<repo>").slice(0, 1_000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

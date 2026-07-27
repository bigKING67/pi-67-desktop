import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getShellConfig, VERSION } from "@earendil-works/pi-coding-agent";
import type { DoctorCheck, DoctorReport, SessionCatalogStatus } from "@pi67/domain";
import { probeNodeSqliteCapability } from "./node-sqlite-capability.js";

const execFileAsync = promisify(execFile);

export async function createDoctorReport(
  shellPath?: string,
  sqliteProbeDirectory?: string,
  sessionCatalogStatus?: SessionCatalogStatus
): Promise<DoctorReport> {
  const shell = getShellConfig(shellPath);
  const [shellResult, gitResult, sqliteResult] = await Promise.all([
    commandVersion(shell.shell, ["--version"]),
    commandVersion("git", ["--version"]),
    probeNodeSqliteCapability(sqliteProbeDirectory)
  ]);
  const checks: DoctorCheck[] = [
    {
      id: "platform",
      label: "Platform",
      status: process.platform === "win32" || process.platform === "darwin" ? "pass" : "fail",
      detail: `${process.platform}/${process.arch}`
    },
    { id: "node", label: "Embedded Node", status: "pass", detail: process.versions.node },
    { id: "pi-sdk", label: "Pi SDK", status: "pass", detail: VERSION },
    {
      id: "sqlite-runtime",
      label: "Embedded SQLite",
      status: sqliteResult.available ? "pass" : "warning",
      detail: sqliteResult.detail
    },
    {
      id: "session-catalog",
      label: "Session Catalog",
      status: isHealthySessionCatalog(sessionCatalogStatus) ? "pass" : "warning",
      detail: formatSessionCatalogStatus(sessionCatalogStatus)
    },
    { id: "shell", label: "Pi shell", status: shellResult.ok ? "pass" : "fail", detail: `${shell.shell} - ${shellResult.detail}` },
    { id: "git", label: "Git", status: gitResult.ok ? "pass" : "warning", detail: gitResult.detail }
  ];
  return { generatedAt: Date.now(), checks };
}

function isHealthySessionCatalog(status: SessionCatalogStatus | undefined): boolean {
  return status?.state === "ready"
    && !status.rebuilding
    && !status.incomplete
    && status.skippedCount === 0;
}

function formatSessionCatalogStatus(status: SessionCatalogStatus | undefined): string {
  if (!status) return "Session Catalog is not configured in this Agent Host runtime.";
  const reconciled = status.reconciledAt === undefined ? "not reconciled" : "reconciled";
  const completeness = status.incomplete ? "incomplete" : "complete";
  const degraded = status.degradedReason === undefined ? "" : `; degraded ${status.degradedReason}`;
  return `schema v1; ${status.state}; ${status.itemCount} items; ${reconciled}; ${completeness}; ${status.skippedCount} skipped${degraded}.`;
}

async function commandVersion(command: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await execFileAsync(command, args, { timeout: 5_000, windowsHide: true });
    const detail = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/u)[0] ?? "Available";
    return { ok: true, detail: detail.slice(0, 300) || "Available" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unavailable";
    return { ok: false, detail: detail.replace(/\s+/gu, " ").slice(0, 300) };
  }
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getShellConfig, VERSION } from "@earendil-works/pi-coding-agent";
import type { DoctorCheck, DoctorReport } from "@pi67/domain";

const execFileAsync = promisify(execFile);

export async function createDoctorReport(shellPath?: string): Promise<DoctorReport> {
  const shell = getShellConfig(shellPath);
  const [shellResult, gitResult] = await Promise.all([
    commandVersion(shell.shell, ["--version"]),
    commandVersion("git", ["--version"])
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
    { id: "shell", label: "Pi shell", status: shellResult.ok ? "pass" : "fail", detail: `${shell.shell} - ${shellResult.detail}` },
    { id: "git", label: "Git", status: gitResult.ok ? "pass" : "warning", detail: gitResult.detail }
  ];
  return { generatedAt: Date.now(), checks };
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

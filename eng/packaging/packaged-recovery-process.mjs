import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

/** Identity is kept in memory only; never select processes by application name. */
export async function readRecoveryProcess(pid, { platform = process.platform, execute = executeFile } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error("Invalid recovery process PID.");
  const options = { timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true };
  if (platform === "darwin") {
    try {
      const { stdout } = await execute("/bin/ps", ["-p", String(pid), "-o", "ppid=,lstart=,comm="], options);
      if (!stdout.trim()) return undefined;
      const match = stdout.trim().match(/^(\d+)\s+(.+)$/u);
      if (!match) throw new Error("Invalid macOS recovery process identity.");
      return { parentPid: Number(match[1]), identity: match[2] };
    } catch (error) {
      if (error.code === 1) return undefined;
      throw error;
    }
  }
  if (platform !== "win32") throw new Error(`Unsupported recovery process platform: ${platform}`);
  // PID is a validated integer; no profile/path/command-line strings enter PowerShell.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$p = Get-CimInstance -ClassName Win32_Process -Filter 'ProcessId = ${pid}'`,
    "if ($null -ne $p) { [PSCustomObject]@{ pid = [int]$p.ProcessId; parentPid = [int]$p.ParentProcessId; startedAt = $p.CreationDate.ToUniversalTime().Ticks.ToString(); executablePath = [string]$p.ExecutablePath } | ConvertTo-Json -Compress }"
  ].join("; ");
  const { stdout } = await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], options);
  if (!stdout.trim()) return undefined;
  const value = JSON.parse(stdout);
  if (value?.pid !== pid || !Number.isSafeInteger(value.parentPid) || value.parentPid < 0
    || typeof value.startedAt !== "string" || !/^\d+$/u.test(value.startedAt)
    || typeof value.executablePath !== "string" || !value.executablePath.trim()) {
    throw new Error("Invalid Windows recovery process identity.");
  }
  return { parentPid: value.parentPid, identity: JSON.stringify([value.startedAt, value.executablePath]) };
}

export async function signalRecoveryProcess(pid, expectedIdentity, signal, {
  read = readRecoveryProcess, kill = (target, value) => process.kill(target, value)
} = {}) {
  if (!expectedIdentity || !["SIGTERM", "SIGKILL"].includes(signal)) throw new Error("Unowned recovery process termination.");
  const current = await read(pid);
  if (!current) return false;
  if (current.identity !== expectedIdentity) throw new Error("Recovery process identity changed; refusing termination.");
  try { kill(pid, signal); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

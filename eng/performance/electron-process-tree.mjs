import { execFileSync } from "node:child_process";

export function collectProcessTree(rootPid, platform = process.platform) {
  const rows = platform === "win32" ? windowsProcesses() : macProcesses();
  return selectProcessTree(rows, rootPid);
}

export function selectProcessTree(rows, rootPid) {
  const processIds = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (processIds.has(row.parentPid) && !processIds.has(row.pid)) {
        processIds.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => processIds.has(row.pid));
}

export function parseMacProcessList(output) {
  return output.trim().split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u);
    return match ? [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      rssBytes: Number(match[3]) * 1024,
      command: match[4]
    }] : [];
  });
}

export function parseWindowsProcessList(output) {
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
    rssBytes: Number(row.WorkingSetSize),
    privateBytes: Number(row.PrivatePageCount),
    command: typeof row.CommandLine === "string" ? row.CommandLine : ""
  }));
}

function macProcesses() {
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], { encoding: "utf8" });
  return parseMacProcessList(output);
}

function windowsProcesses() {
  const script = [
    "Get-CimInstance Win32_Process",
    "Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount,CommandLine",
    "ConvertTo-Json -Compress"
  ].join(" | ");
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  return parseWindowsProcessList(output);
}

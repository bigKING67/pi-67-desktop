import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { cleanupRecoveryProcesses, readRecoveryMainProcess, readRecoveryProcess, readWindowsRecoveryExitState, signalRecoveryProcess } from "./packaged-recovery-process.mjs";

const pid = 123456;
const win = { pid, parentPid: 123455, startedAt: "639267123456789012", executablePath: "C:\\隔离 测试\\New Money.exe" };

describe("packaged recovery process cleanup", () => {
  it.each(["reused", "query-fails"])("does not re-query a confirmed exit when its PID later %s", async later => {
    const read = vi.fn().mockResolvedValueOnce({ identity: "owned" }).mockResolvedValueOnce(undefined);
    if (later === "reused") read.mockResolvedValue({ identity: "unrelated" });
    else read.mockRejectedValue(new Error("late query unavailable"));
    const kill = vi.fn();
    expect(await cleanupRecoveryProcesses(new Map([[pid, "owned"]]), { read, kill })).toEqual({
      allExited: true, failure: undefined, processes: [{ pid, status: "exited" }]
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(kill).toHaveBeenCalledExactlyOnceWith(pid, "SIGTERM");
  });

  it("retires an already absent identity without another query or signal", async () => {
    const read = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue({ identity: "replacement" });
    const kill = vi.fn();
    expect((await cleanupRecoveryProcesses(new Map([[pid, "owned"]]), { read, kill })).allExited).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  it.each(["query", "identity", "unknown", "alive"])("retains %s failure and continues cleaning other owned processes", async mode => {
    let time = 0;
    const queryError = new Error("CIM lookup unavailable");
    const read = vi.fn(async target => {
      if (target !== pid) return undefined;
      if (mode === "query") throw queryError;
      return { identity: mode === "identity" ? "replacement" : "owned" };
    });
    const kill = vi.fn();
    const result = await cleanupRecoveryProcesses(new Map([[pid, mode === "unknown" ? undefined : "owned"], [pid + 1, "other"]]),
      { read, kill, timeoutMs: 200, now: () => time, wait: async ms => { time += ms; } });
    expect(result.allExited).toBe(false);
    expect(result.processes).toEqual([
      { pid, status: "unverified", error: expect.any(String) }, { pid: pid + 1, status: "exited" }
    ]);
    expect(result.failure.message).toMatch(/unavailable|identity changed|Unowned|Timed out/u);
    if (mode === "query") expect(result.failure).toBe(queryError);
    if (mode !== "alive") expect(kill).not.toHaveBeenCalled();
  });

  it("rejects identity replacement during exit polling instead of claiming an exit", async () => {
    const read = vi.fn().mockResolvedValueOnce({ identity: "owned" }).mockResolvedValue({ identity: "replacement" });
    const result = await cleanupRecoveryProcesses(new Map([[pid, "owned"]]), { read, kill: vi.fn() });
    expect(result.allExited).toBe(false);
    expect(result.failure.message).toContain("identity changed before exit confirmation");
  });

  it("does not begin another query after the exit deadline and still cleans other processes", async () => {
    let time = 0;
    let ownedReads = 0;
    const read = vi.fn(async target => target === pid && ++ownedReads <= 2 ? { identity: "owned" } : undefined);
    const result = await cleanupRecoveryProcesses(new Map([[pid, "owned"], [pid + 1, "other"]]), {
      read, kill: vi.fn(), timeoutMs: 50, now: () => time, wait: async ms => { time += ms; }
    });
    expect(ownedReads).toBe(2);
    expect(result.allExited).toBe(false);
    expect(result.failure.message).toBe("Timed out: fixture process cleanup");
    expect(result.processes[1]).toEqual({ pid: pid + 1, status: "exited" });
  });
});

describe("packaged recovery process ownership", () => {
  it.each(["darwin", "win32"])("uses the application Main PID instead of assuming the driver PID on %s", async platform => {
    const driverPid = platform === "win32" ? pid - 1 : pid;
    const application = { process: () => ({ pid: driverPid }), evaluate: async () => pid };
    const read = vi.fn().mockResolvedValue({ parentPid: pid - 1, identity: "owned-main" });
    expect(await readRecoveryMainProcess(application, { platform, read })).toEqual({
      pid, driverPid, parentPid: pid - 1, identity: "owned-main"
    });
    expect(read).toHaveBeenCalledExactlyOnceWith(pid);
  });

  it("rejects missing or foreign Main processes before fault injection", async () => {
    const application = { process: () => ({ pid: pid - 1 }), evaluate: async () => pid };
    const read = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue({ parentPid: pid - 2, identity: "foreign" });
    await expect(readRecoveryMainProcess(application, { platform: "win32", read })).rejects.toThrow("exited before identity capture");
    await expect(readRecoveryMainProcess(application, { platform: "win32", read })).rejects.toThrow("not owned");
    await expect(readRecoveryMainProcess(application, { platform: "darwin", read })).rejects.toThrow("not owned");
  });

  it.each([{ missing: true }, { missing: false, hasExited: false, exitCode: null },
    { missing: false, hasExited: true, exitCode: 70 }])("keeps native exit diagnostics separate from PID ownership: %j", async value => {
    const execute = vi.fn().mockResolvedValue({ stdout: JSON.stringify(value) });
    expect(await readWindowsRecoveryExitState(pid, { execute })).toEqual(value);
    expect(execute.mock.calls[0][1].at(-1)).toContain(`[System.Diagnostics.Process]::GetProcessById(${pid})`);
    expect(execute.mock.calls[0][1].at(-1)).not.toMatch(/Stop-Process|taskkill|CommandLine/u);
  });

  it("does not interpret missing or failed native exit diagnostics as successful termination", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ stdout: '{}' }).mockRejectedValueOnce(new Error("query unavailable"));
    await expect(readWindowsRecoveryExitState(pid, { execute })).rejects.toThrow("Invalid Windows");
    await expect(readWindowsRecoveryExitState(pid, { execute })).rejects.toThrow("query unavailable");
  });
  it("queries only the exact Windows PID and binds identity to creation time and image", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: windowsIdentityOutput(win) });
    expect(await readRecoveryProcess(pid, { platform: "win32", execute })).toEqual({
      parentPid: win.parentPid, identity: JSON.stringify([win.startedAt, win.executablePath])
    });
    const [command, args, options] = execute.mock.calls[0];
    expect(command).toBe("powershell.exe");
    expect(args).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", expect.stringContaining(`-Filter 'ProcessId = ${pid}'`)]);
    // Query only the built-in CIM module; scalar output must not load JSON serialization.
    expect(args.at(-1)).toContain("$PSModuleAutoLoadingPreference = 'None'");
    expect(args.at(-1)).toContain('Microsoft.PowerShell.Core\\Import-Module -Name "$PSHOME\\Modules\\CimCmdlets\\CimCmdlets.psd1" -ErrorAction Stop');
    expect(args.at(-1)).toContain("CimCmdlets\\Get-CimInstance");
    expect(args.at(-1)).toContain("[Console]::Out.WriteLine('PI67_RECOVERY_PROCESS:'");
    expect(args.at(-1)).toContain("[Text.Encoding]::UTF8.GetBytes");
    expect(args.at(-1)).not.toMatch(/ConvertTo-Json|Microsoft.PowerShell.Utility/u);
    expect(args.at(-1)).not.toMatch(/CommandLine|Stop-Process|taskkill/u);
    expect(options).toMatchObject({ timeout: 15000, windowsHide: true });
  });

  it.each([null, { ...win, pid: 7 }, { ...win, startedAt: "" }, { ...win, executablePath: "" }, { ...win, parentPid: -1 }])(
    "rejects unverifiable Windows identity: %j", async value => {
      const execute = vi.fn().mockResolvedValue({ stdout: windowsIdentityOutput(value) });
      await expect(readRecoveryProcess(pid, { platform: "win32", execute })).rejects.toThrow("Invalid Windows");
    }
  );

  it("distinguishes a gone Windows process from a failed query", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ stdout: "\r\n" }).mockRejectedValueOnce(new Error("CIM lookup failed"));
    expect(await readRecoveryProcess(pid, { platform: "win32", execute })).toBeUndefined();
    await expect(readRecoveryProcess(pid, { platform: "win32", execute })).rejects.toThrow("CIM lookup failed");
  });

  it.each([
    "PI67_RECOVERY_PROCESS:123456:1:1:Qx==", // Non-canonical base64.
    "PI67_RECOVERY_PROCESS:123456:1:1:/w==", // Invalid UTF-8.
    "PI67_RECOVERY_PROCESS:123456:9007199254740992:1:Qw==",
    `${windowsIdentityOutput(win)}\n${windowsIdentityOutput(win)}`,
    `${windowsIdentityOutput(win)}:extra`,
    JSON.stringify(win)
  ])("rejects malformed process output without signaling a process", async stdout => {
    const execute = vi.fn().mockResolvedValue({ stdout });
    await expect(readRecoveryProcess(pid, { platform: "win32", execute })).rejects.toThrow("Invalid Windows");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps missing built-in modules fatal without falling back to command discovery", async () => {
    const cause = Object.assign(new Error("Required module unavailable"), { code: 1 });
    const execute = vi.fn().mockRejectedValue(cause);
    await expect(readRecoveryProcess(pid, { platform: "win32", execute })).rejects.toMatchObject({ cause });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][1].at(-1)).not.toMatch(/SilentlyContinue|AutoLoadingPreference = 'All'|AutoLoadingPreference = 'ModuleQualified'/u);
  });

  it("retains bounded Windows query timeout evidence without treating it as process exit", async () => {
    const cause = Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM", stderr: "" });
    const execute = vi.fn().mockRejectedValue(cause);
    await expect(readRecoveryProcess(pid, { platform: "win32", execute })).rejects.toMatchObject({
      message: "Windows recovery process query failed (timed out after 15000 ms): Command failed", cause
    });
  });

  it("separates PowerShell startup, query and output timing from process identity", async () => {
    const stages = ["script-started", "modules-started", "modules-completed", "query-started", "query-completed", "output-completed"];
    const stderr = stages.map((stage, index) => `PI67_RECOVERY_PROCESS_QUERY:${stage}:${(index + 1) * 100}`).join("\r\n");
    const onDiagnostic = vi.fn();
    const execute = vi.fn().mockResolvedValue({ stdout: windowsIdentityOutput(win), stderr });
    const result = await readRecoveryProcess(pid, { platform: "win32", execute, onDiagnostic });
    expect(result.identity).toBe(JSON.stringify([win.startedAt, win.executablePath]));
    expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith({ outcome: "command-completed", durationMs: expect.any(Number),
      timeoutMs: 15000, stages: stages.map((stage, index) => ({ stage, elapsedMs: (index + 1) * 100 })) });
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain(win.executablePath);
    const script = execute.mock.calls[0][1].at(-1);
    expect(script.indexOf("script-started")).toBeLessThan(script.indexOf("Get-CimInstance"));
    expect(script).toContain("[Console]::Error.Flush()");
    expect(script.indexOf("modules-started")).toBeLessThan(script.indexOf("Import-Module"));
    expect(script.indexOf("modules-completed")).toBeGreaterThan(script.indexOf("CimCmdlets.psd1"));
  });

  it("retains partial stage evidence on timeout even when stdout resembles a valid identity", async () => {
    const stderr = "PI67_RECOVERY_PROCESS_QUERY:script-started:920\nPI67_RECOVERY_PROCESS_QUERY:modules-started:922\n";
    const cause = Object.assign(new Error("Command timed out"), { killed: true, stderr, stdout: windowsIdentityOutput(win) });
    const execute = vi.fn().mockRejectedValue(cause);
    const onDiagnostic = vi.fn();
    await expect(readRecoveryProcess(pid, { platform: "win32", execute, onDiagnostic })).rejects.toMatchObject({
      cause, processQueryDiagnostic: { outcome: "command-failed", timeoutMs: 15000,
        stages: [{ stage: "script-started", elapsedMs: 920 }, { stage: "modules-started", elapsedMs: 922 }] }
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(onDiagnostic).toHaveBeenCalledOnce();
  });

  it("excludes unknown fields and bounds diagnostic records without changing query acceptance", async () => {
    const stderr = ["secret-output", "PI67_RECOVERY_PROCESS_QUERY:query-started:0",
      "PI67_RECOVERY_PROCESS_QUERY:script-started:1:secret", "PI67_RECOVERY_PROCESS_QUERY:script-started:1",
      ...Array(50).fill("PI67_RECOVERY_PROCESS_QUERY:script-started:1"),
      "PI67_RECOVERY_PROCESS_QUERY:modules-started:2", "PI67_RECOVERY_PROCESS_QUERY:modules-completed:3",
      "PI67_RECOVERY_PROCESS_QUERY:query-started:4", "PI67_RECOVERY_PROCESS_QUERY:query-completed:5",
      "PI67_RECOVERY_PROCESS_QUERY:output-completed:6", "PI67_RECOVERY_PROCESS_QUERY:output-completed:7"].join("\n");
    const onDiagnostic = vi.fn();
    const execute = vi.fn().mockResolvedValue({ stdout: "", stderr });
    expect(await readRecoveryProcess(pid, { platform: "win32", execute, onDiagnostic })).toBeUndefined();
    expect(onDiagnostic.mock.calls[0][0].stages).toHaveLength(6);
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain("secret");
  });

  it.each([0, -1, 1.5, process.pid, "12; Stop-Process -Name test"])("rejects invalid/self PID %s before execution", async value => {
    const execute = vi.fn();
    await expect(readRecoveryProcess(value, { platform: "win32", execute })).rejects.toThrow("Invalid recovery process PID");
    expect(execute).not.toHaveBeenCalled();
  });

  it("reads macOS parent and identity without collecting command arguments", async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: "  8 Sun Oct  4 14:00:00 2026 /Applications/New Money.app/Contents/MacOS/New Money\n" });
    expect(await readRecoveryProcess(pid, { platform: "darwin", execute })).toEqual({
      parentPid: 8, identity: "Sun Oct  4 14:00:00 2026 /Applications/New Money.app/Contents/MacOS/New Money"
    });
    expect(execute.mock.calls[0][1]).toEqual(["-p", String(pid), "-o", "ppid=,lstart=,comm="]);
  });

  it("does not terminate reused, unknown or unverifiable PIDs", async () => {
    const kill = vi.fn();
    const read = vi.fn().mockResolvedValueOnce({ identity: "replacement" }).mockRejectedValueOnce(new Error("lookup unavailable"));
    await expect(signalRecoveryProcess(pid, "owned", "SIGTERM", { read, kill })).rejects.toThrow("identity changed");
    await expect(signalRecoveryProcess(pid, "owned", "SIGTERM", { read, kill })).rejects.toThrow("lookup unavailable");
    await expect(signalRecoveryProcess(pid, undefined, "SIGTERM", { read, kill })).rejects.toThrow("Unowned");
    expect(kill).not.toHaveBeenCalled();
  });

  it("signals only a matching identity and tolerates an exit during that check", async () => {
    const read = vi.fn().mockResolvedValue({ identity: "owned" });
    const kill = vi.fn().mockImplementationOnce(() => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); });
    expect(await signalRecoveryProcess(pid, "owned", "SIGKILL", { read, kill })).toBe(false);
    expect(await signalRecoveryProcess(pid, "owned", "SIGTERM", { read, kill })).toBe(true);
    read.mockResolvedValue(undefined);
    expect(await signalRecoveryProcess(pid, "owned", "SIGTERM", { read, kill })).toBe(false);
    expect(kill.mock.calls).toEqual([[pid, "SIGKILL"], [pid, "SIGTERM"]]);
  });

  it.skipIf(process.platform !== "darwin" && process.platform !== "win32")("observes and closes an owned real child", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const exited = once(child, "exit");
    await once(child, "spawn");
    try {
      const observed = await readRecoveryProcess(child.pid, {
        onDiagnostic: diagnostic => console.log(`Windows recovery cold query: ${JSON.stringify(diagnostic)}`)
      });
      expect(observed.parentPid).toBe(process.pid);
      expect(await signalRecoveryProcess(child.pid, observed.identity, "SIGTERM")).toBe(true);
      await exited;
      expect(await readRecoveryProcess(child.pid)).toBeUndefined();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }, 15000);
});

function windowsIdentityOutput(value) {
  if (!value) return "invalid";
  return `PI67_RECOVERY_PROCESS:${value.pid}:${value.parentPid}:${value.startedAt}:${Buffer.from(value.executablePath, "utf8").toString("base64")}`;
}

import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { readRecoveryProcess, readWindowsRecoveryExitState, signalRecoveryProcess } from "./packaged-recovery-process.mjs";

const pid = 123456;
const win = { pid, parentPid: 123455, startedAt: "639267123456789012", executablePath: "C:\\隔离 测试\\New Money.exe" };

describe("packaged recovery process ownership", () => {
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
    const execute = vi.fn().mockResolvedValue({ stdout: JSON.stringify(win) });
    expect(await readRecoveryProcess(pid, { platform: "win32", execute })).toEqual({
      parentPid: win.parentPid, identity: JSON.stringify([win.startedAt, win.executablePath])
    });
    const [command, args, options] = execute.mock.calls[0];
    expect(command).toBe("powershell.exe");
    expect(args).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", expect.stringContaining(`-Filter 'ProcessId = ${pid}'`)]);
    expect(args.at(-1)).not.toMatch(/CommandLine|Stop-Process|taskkill/u);
    expect(options).toMatchObject({ timeout: 15000, windowsHide: true });
  });

  it.each([null, { ...win, pid: 7 }, { ...win, startedAt: "" }, { ...win, executablePath: "" }, { ...win, parentPid: -1 }])(
    "rejects unverifiable Windows identity: %j", async value => {
      const execute = vi.fn().mockResolvedValue({ stdout: JSON.stringify(value) });
      await expect(readRecoveryProcess(pid, { platform: "win32", execute })).rejects.toThrow("Invalid Windows");
    }
  );

  it("distinguishes a gone Windows process from a failed query", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ stdout: "\r\n" }).mockRejectedValueOnce(new Error("CIM lookup failed"));
    expect(await readRecoveryProcess(pid, { platform: "win32", execute })).toBeUndefined();
    await expect(readRecoveryProcess(pid, { platform: "win32", execute })).rejects.toThrow("CIM lookup failed");
  });

  it("retains bounded Windows query timeout evidence without treating it as process exit", async () => {
    const cause = Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM", stderr: "" });
    const execute = vi.fn().mockRejectedValue(cause);
    await expect(readRecoveryProcess(pid, { platform: "win32", execute })).rejects.toMatchObject({
      message: "Windows recovery process query failed (timed out after 15000 ms): Command failed", cause
    });
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
      const observed = await readRecoveryProcess(child.pid);
      expect(observed.parentPid).toBe(process.pid);
      expect(await signalRecoveryProcess(child.pid, observed.identity, "SIGTERM")).toBe(true);
      await exited;
      expect(await readRecoveryProcess(child.pid)).toBeUndefined();
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }, 15000);
});

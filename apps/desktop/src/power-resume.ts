import { powerMonitor } from "electron";

interface PowerResumeWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string): void;
  };
}

interface PowerResumeSource {
  on(event: "resume" | "suspend", listener: () => void): unknown;
  off(event: "resume" | "suspend", listener: () => void): unknown;
}

interface RegisterPowerResumeRecoveryOptions {
  getMainWindow: () => PowerResumeWindow | undefined;
  onResume?: () => void;
  onSuspend?: () => void;
  source?: PowerResumeSource;
}

export function registerPowerResumeRecovery(
  options: RegisterPowerResumeRecoveryOptions
): () => void {
  const source = options.source ?? powerMonitor;
  const handleSuspend = () => options.onSuspend?.();
  const handleResume = () => {
    options.onResume?.();
    const window = options.getMainWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send("pi67:power-resumed");
  };
  source.on("resume", handleResume);
  source.on("suspend", handleSuspend);
  return () => { source.off("resume", handleResume); source.off("suspend", handleSuspend); };
}

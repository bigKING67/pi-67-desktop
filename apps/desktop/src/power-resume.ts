import { powerMonitor } from "electron";

interface PowerResumeWindow {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string): void;
  };
}

interface PowerResumeSource {
  on(event: "resume", listener: () => void): unknown;
  off(event: "resume", listener: () => void): unknown;
}

interface RegisterPowerResumeRecoveryOptions {
  getMainWindow: () => PowerResumeWindow | undefined;
  onResume?: () => void;
  source?: PowerResumeSource;
}

export function registerPowerResumeRecovery(
  options: RegisterPowerResumeRecoveryOptions
): () => void {
  const source = options.source ?? powerMonitor;
  const handleResume = () => {
    options.onResume?.();
    const window = options.getMainWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send("pi67:power-resumed");
  };
  source.on("resume", handleResume);
  return () => source.off("resume", handleResume);
}

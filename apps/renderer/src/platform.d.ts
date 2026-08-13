import type { DesktopSystemBridge } from "@pi67/protocol";

declare global {
  interface Window {
    pi67: {
      system: DesktopSystemBridge;
    };
  }
}

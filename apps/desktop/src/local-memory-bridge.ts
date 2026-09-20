import type { BrowserWindow } from "electron";
import { registerLocalMemorySettingsBridge } from "./local-memory-settings-bridge.js";
import { registerLocalMemoryRuntimeBridge } from "./local-memory-runtime-bridge.js";
import { registerLocalMemoryActivationBridge } from "./local-memory-activation-bridge.js";
import type { LocalMemorySettingsController } from "./local-memory-settings-controller.js";
import type { LocalMemoryRuntimeController } from "./local-memory-runtime-controller.js";
import type { LocalMemoryActivationController } from "./local-memory-activation-controller.js";

export interface LocalMemoryBridgeOptions {
  getMainWindow: () => BrowserWindow | undefined;
  getLocalMemorySettings?: () => LocalMemorySettingsController | undefined;
  getLocalMemoryRuntime?: () => LocalMemoryRuntimeController | undefined;
  getLocalMemoryActivation?: () => LocalMemoryActivationController | undefined;
  rendererUrl?: string;
}
/** Single Main registration lifetime for the three independent memory settings surfaces. */
export function registerLocalMemoryBridge(options: LocalMemoryBridgeOptions): () => void {
  const disposers = [
    registerLocalMemorySettingsBridge(options.getMainWindow, () => options.getLocalMemorySettings?.(), options.rendererUrl),
    registerLocalMemoryRuntimeBridge(options.getMainWindow, () => options.getLocalMemoryRuntime?.(), options.rendererUrl),
    registerLocalMemoryActivationBridge(options.getMainWindow, () => options.getLocalMemoryActivation?.(), options.rendererUrl)
  ];
  return () => { for (const dispose of disposers) dispose(); };
}

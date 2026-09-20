import { isAbsolute, join } from "node:path";
import type { DesktopTextEncryption } from "./desktop-text-encryption.js";
import type { LocalMemoryModelClient } from "./local-memory-model-client.js";
import { createInstalledLocalMemory } from "./installed-local-memory.js";
import { LocalMemorySettingsController } from "./local-memory-settings-controller.js";
import { OPENVIKING_INSTALLATION_NAME, OPENVIKING_QUERY_INSTALLATION_NAME, OPENVIKING_TEAM_INSTALLATION_NAME } from "./openviking-runtime-installer.js";
import { LocalMemoryRuntimeController } from "./local-memory-runtime-controller.js";
import { LocalMemoryActivationStore } from "./local-memory-activation-store.js";
import { LocalMemoryActivationController } from "./local-memory-activation-controller.js";

/** Main-owned fixed layout. Construction neither probes nor creates user storage. */
export function createApplicationLocalMemory(options: {
  appData: string;
  /** Explicit Electron --user-data-dir profile; never inferred from NODE_ENV. */
  isolatedUserData?: string;
  platform: NodeJS.Platform;
  arch: string;
  encryption: DesktopTextEncryption;
  models: Pick<LocalMemoryModelClient, "resolve">;
}) {
  if (!isAbsolute(options.appData) || options.appData.includes("\0")) throw new Error("Invalid application data root.");
  if (options.isolatedUserData !== undefined && (!isAbsolute(options.isolatedUserData)
    || options.isolatedUserData.includes("\0"))) throw new Error("Invalid isolated profile root.");
  // Windows process-tree containment and native admission are not certified yet.
  if (options.platform !== "darwin" || options.arch !== "arm64") return undefined;
  const memoryRoot = options.isolatedUserData === undefined
    ? join(options.appData, "New Money", "openviking") : join(options.isolatedUserData, "openviking");
  const installationRoot = join(memoryRoot, "runtime", OPENVIKING_INSTALLATION_NAME);
  const teamInstallationRoot = join(memoryRoot, "runtime", OPENVIKING_TEAM_INSTALLATION_NAME);
  const queryInstallationRoot = join(memoryRoot, "runtime", OPENVIKING_QUERY_INSTALLATION_NAME);
  const installed = createInstalledLocalMemory({ memoryRoot, installationRoot, teamInstallationRoot, queryInstallationRoot,
    encryption: options.encryption, models: options.models });
  const runtime = new LocalMemoryRuntimeController(options.isolatedUserData ?? options.appData,
    options.isolatedUserData === undefined ? ["New Money", "openviking"] : ["openviking"]);
  const activation = new LocalMemoryActivationController({
    store: new LocalMemoryActivationStore(memoryRoot), service: installed.service,
    async prerequisites() {
      if (await runtime.getStatus("private") !== "present") return "runtime-missing";
      return await installed.settings.load() ? "ready" : "models-missing";
    }
  });
  return { ...installed, memoryRoot, activation, runtime, modelSettings: new LocalMemorySettingsController(installed.settings) };
}

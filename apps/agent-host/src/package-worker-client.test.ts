import { createInMemoryPiWorkspaceRuntimeServices } from "@pi67/pi-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  PackageWorkerClient,
  createWorkerBackedExtensionPackageManagement,
  type PackageWorkerPort
} from "./package-worker-client.js";

describe("Isolated Package Worker client", () => {
  it("fails closed instead of using system Node/npm/Git", async () => {
    const services = createInMemoryPiWorkspaceRuntimeServices({
      cwd: process.cwd(),
      agentDir: process.cwd()
    });
    const client = new PackageWorkerClient({ environment: {} });
    await expect(client.run("check-updates", services)).rejects.toMatchObject({
      code: "TOOLCHAIN_MISSING",
      recoverable: false
    });
    await services.dispose();
  });

  it("reloads parent SettingsManager state after a worker mutation", async () => {
    const services = createInMemoryPiWorkspaceRuntimeServices({
      cwd: process.cwd(),
      agentDir: process.cwd()
    });
    const run = vi.fn<PackageWorkerPort["run"]>(async (action, workerServices, target) => {
      expect(action).toBe("install");
      workerServices.settingsManager.setPackages([target!.source]);
      await workerServices.settingsManager.flush();
      return {
        items: [{
          source: target!.source,
          scope: "global",
          enabled: true,
          filtered: false,
          installed: false
        }],
        total: 1,
        changed: true
      };
    });
    const management = createWorkerBackedExtensionPackageManagement(services, { run });

    await expect(management.install("npm:pi-example", "global")).resolves.toMatchObject({
      changed: true,
      items: [{ source: "npm:pi-example", scope: "global" }]
    });
    expect(run).toHaveBeenCalledOnce();
    await services.dispose();
  });
});

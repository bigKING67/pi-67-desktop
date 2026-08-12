import { beforeEach, describe, expect, it, vi } from "vitest";

const fileSystem = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn()
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  readFile: fileSystem.readFile,
  stat: fileSystem.stat
}));

import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { PiAuthCredentialStore } from "./pi-auth-credential-store.js";
import { readWorkspaceConfigurationBundle } from "./pi-configuration-file-state.js";
import { resolvePiConfigurationServiceOptions } from "./pi-configuration-service-options.js";

describe("Pi configuration read budgets", () => {
  beforeEach(() => {
    fileSystem.readFile.mockReset();
    fileSystem.stat.mockReset();
  });

  it("keeps the default configuration file access budget bounded at four seconds", () => {
    expect(resolvePiConfigurationServiceOptions({}).fileAccessWaitMs).toBe(4_000);
    expect(resolvePiConfigurationServiceOptions({ fileAccessWaitMs: 5 }).fileAccessWaitMs).toBe(5);
  });

  it("fails a stalled configuration bundle read with a structured bounded error", async () => {
    fileSystem.stat.mockReturnValue(new Promise(() => undefined));
    const privateRoot = "/private/pi67-agent";

    const failure = await readWorkspaceConfigurationBundle({
      modelsPath: `${privateRoot}/models.json`,
      authPath: `${privateRoot}/auth.json`,
      globalSettingsPath: `${privateRoot}/settings.json`
    }, {
      cwd: "/private/workspace",
      settingsManager: SettingsManager.inMemory(),
      projectTrusted: true,
      registrations: 1,
      listeners: new Set(),
      runtimes: new Set()
    }, 5).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "RUNTIME_NOT_READY",
      recoverable: true,
      details: { stage: "configuration-file-access", waitMs: 5 }
    });
    expect(String((failure as Error).message)).not.toContain(privateRoot);
    expect(fileSystem.readFile).not.toHaveBeenCalled();
  });

  it("turns a stalled auth.json read into a bounded diagnostic without exposing its path", async () => {
    fileSystem.readFile.mockReturnValue(new Promise(() => undefined));
    const privatePath = "/private/pi67-agent/auth.json";
    const store = new PiAuthCredentialStore(privatePath, { readWaitMs: 5 });

    const diagnostic = await store.reload();

    expect(diagnostic).toContain("bounded startup budget");
    expect(diagnostic).not.toContain(privatePath);
  });
});

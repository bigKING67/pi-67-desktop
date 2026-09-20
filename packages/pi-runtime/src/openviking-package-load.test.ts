import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSessionServices,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManagedOpenVikingExtension } from "../../openviking-pi-extension/managed-extension.js";
import { createDesktopSessionServices } from "./session-services.js";

const extensionRoot = fileURLToPath(new URL("../../openviking-pi-extension/", import.meta.url));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
let temporaryRoot = "";

afterEach(async () => {
  vi.unstubAllEnvs();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

describe("OpenViking Pi package loader", () => {
  it.each(["ready", "failed", "off"] as const)("uses one existing owner via the Desktop session bus: %s", async (state) => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-memory-bus-loader-"));
    const agentDir = join(temporaryRoot, "agent"); const cwd = join(temporaryRoot, "workspace");
    await Promise.all([mkdir(agentDir), mkdir(cwd)]);
    await writeFile(join(agentDir, "openviking.json"), JSON.stringify({ enabled: state !== "off",
      privacyMode: "read-only", takeover: { enabled: false } }));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    vi.stubEnv("PI67_DESKTOP", "0");
    const profile = "e728ad55-4d62-4c2d-8587-f7bd2332309a";
    const connect = vi.fn(async () => {
      if (state === "failed") throw new Error("synthetic-secret-must-not-reach-diagnostics");
      return { endpoint: "http://127.0.0.1:32101", apiKey: "synthetic-key", user: "desktop",
        account: `private-${profile}`, localProfileId: profile };
    });
    const services = await createDesktopSessionServices({ cwd, agentDir,
      settingsManager: SettingsManager.inMemory({ packages: [extensionRoot] }), localMemory: { connect },
      getSafety: () => ({ cwd, trust: "trusted", approvalMode: "guided", taskToolMode: "ask" }),
      requestApproval: async () => ({ status: "denied" }) });
    const loaded = services.resourceLoader.getExtensions();
    expect(connect).toHaveBeenCalledTimes(state === "off" ? 0 : 1);
    expect(JSON.stringify(loaded.errors)).not.toContain("synthetic-secret");
    const owners = loaded.extensions.filter((entry) => entry.resolvedPath === join(extensionRoot, "index.ts"));
    if (state === "failed") {
      expect(owners).toHaveLength(0);
      expect(loaded.errors).toEqual([expect.objectContaining({ error: "Failed to load extension: Managed local memory is unavailable." })]);
    } else {
      expect(owners).toHaveLength(1); expect(loaded.errors).toEqual([]);
    }
  });

  it("loads the managed private factory through Pi without adopting an external package", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-managed-openviking-loader-"));
    const agentDir = join(temporaryRoot, "agent"); const cwd = join(temporaryRoot, "workspace");
    await Promise.all([mkdir(agentDir), mkdir(cwd)]);
    await writeFile(join(agentDir, "openviking.json"), JSON.stringify({
      enabled: true, privacyMode: "read-only", takeover: { enabled: false }
    }));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const profile = "e728ad55-4d62-4c2d-8587-f7bd2332309a";
    const factory = createManagedOpenVikingExtension({ endpoint: "http://127.0.0.1:32101",
      apiKey: "synthetic-key", account: `private-${profile}`, user: "desktop", localProfileId: profile });
    const services = await createAgentSessionServices({ cwd, agentDir,
      settingsManager: SettingsManager.inMemory({}),
      resourceLoaderOptions: { noExtensions: true, extensionFactories: [factory] } });
    const loaded = services.resourceLoader.getExtensions();
    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions).toHaveLength(1);
    expect(loaded.extensions[0]!.commands.has("viking")).toBe(true);
  });

  it("loads the complete Extension through Pi ResourceLoader", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-openviking-loader-"));
    const agentDir = join(temporaryRoot, "agent");
    const cwd = join(temporaryRoot, "workspace");
    await Promise.all([mkdir(agentDir), mkdir(cwd)]);
    await Promise.all([
      writeFile(join(agentDir, "settings.json"), "{}\n", "utf8"),
      writeFile(join(agentDir, "openviking.json"), JSON.stringify({
        enabled: true,
        endpoint: "http://127.0.0.1:1933",
        privacyMode: "read-only",
        takeover: { enabled: false },
      }), "utf8"),
    ]);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const settingsManager = SettingsManager.inMemory({ packages: [extensionRoot] });
    const services = await createAgentSessionServices({ cwd, agentDir, settingsManager });
    const loaded = services.resourceLoader.getExtensions();

    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions.map((extension) => extension.resolvedPath)).toContain(
      join(extensionRoot, "index.ts"),
    );
  });
});

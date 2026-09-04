import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadConfig,
  tightenRuntimePrivacy,
  tightenRuntimePrivacyFromModuleUrl,
} from "./config.js";

describe("OpenViking runtime privacy", () => {
  let root = "";
  let extensionDir = "";
  let agentDir = "";
  let previousAgentDir: string | undefined;
  let previousUrl: string | undefined;
  let previousPrivacy: string | undefined;
  let previousCredentialSource: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pi67-openviking-config-"));
    extensionDir = join(root, "extension");
    agentDir = join(root, "agent");
    await Promise.all([
      mkdir(extensionDir, { recursive: true }),
      mkdir(agentDir, { recursive: true }),
    ]);
    previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    previousUrl = process.env.OPENVIKING_URL;
    previousPrivacy = process.env.PI67_MEMORY_PRIVACY_MODE;
    previousCredentialSource = process.env.OPENVIKING_CREDENTIAL_SOURCE;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.OPENVIKING_URL = "http://127.0.0.1:1933";
    process.env.OPENVIKING_CREDENTIAL_SOURCE = "env";
    delete process.env.PI67_MEMORY_PRIVACY_MODE;
    await writeExtensionConfig("full-learning");
    await writeUserConfig("full-learning");
  });

  afterEach(async () => {
    restoreEnv("PI_CODING_AGENT_DIR", previousAgentDir);
    restoreEnv("OPENVIKING_URL", previousUrl);
    restoreEnv("PI67_MEMORY_PRIVACY_MODE", previousPrivacy);
    restoreEnv("OPENVIKING_CREDENTIAL_SOURCE", previousCredentialSource);
    await rm(root, { recursive: true, force: true });
  });

  it("tightens a loaded Session immediately but never widens it", async () => {
    const current = loadConfig(extensionDir);
    expect(current).toMatchObject({
      enabled: true,
      privacyMode: "full-learning",
      privateWriteEnabled: true,
      enterpriseCandidateEnabled: true,
      syncTurns: true,
      takeoverEnabled: true,
      captureAssistantTurns: true,
    });

    await writeUserConfig("read-only");
    tightenRuntimePrivacy(current, loadConfig(extensionDir));
    expect(current).toMatchObject({
      enabled: true,
      privacyMode: "read-only",
      privateWriteEnabled: false,
      enterpriseCandidateEnabled: false,
      syncTurns: false,
      takeoverEnabled: false,
      captureAssistantTurns: false,
    });

    await writeUserConfig("full-learning");
    tightenRuntimePrivacy(current, loadConfig(extensionDir));
    expect(current).toMatchObject({
      privacyMode: "read-only",
      privateWriteEnabled: false,
      enterpriseCandidateEnabled: false,
      syncTurns: false,
      takeoverEnabled: false,
      captureAssistantTurns: false,
    });

    await writeUserConfig("off");
    tightenRuntimePrivacyFromModuleUrl(current, new URL("config.ts", `file://${extensionDir}/`).href);
    expect(current).toMatchObject({ enabled: false, privacyMode: "off" });

    await writeUserConfig("private-learning");
    tightenRuntimePrivacy(current, loadConfig(extensionDir));
    expect(current).toMatchObject({ enabled: false, privacyMode: "off" });
  });

  it("fails closed when the persisted user configuration is invalid", async () => {
    await writeFile(join(agentDir, "openviking.json"), "{ invalid json", "utf8");
    expect(loadConfig(extensionDir)).toMatchObject({
      enabled: false,
      privacyMode: "off",
      privateWriteEnabled: false,
      enterpriseCandidateEnabled: false,
      syncTurns: false,
      takeoverEnabled: false,
    });
  });

  async function writeExtensionConfig(privacyMode: string): Promise<void> {
    await writeFile(join(extensionDir, "config.json"), JSON.stringify({
      enabled: true,
      privacyMode,
      syncTurns: true,
      captureAssistantTurns: true,
      takeover: { enabled: true },
    }), "utf8");
  }

  async function writeUserConfig(privacyMode: string): Promise<void> {
    await writeFile(join(agentDir, "openviking.json"), JSON.stringify({
      enabled: privacyMode !== "off",
      privacyMode,
      syncTurns: true,
      captureAssistantTurns: true,
      takeover: { enabled: true },
    }), "utf8");
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

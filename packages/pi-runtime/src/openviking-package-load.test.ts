import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSessionServices,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

const extensionRoot = fileURLToPath(new URL("../../openviking-pi-extension/", import.meta.url));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
let temporaryRoot = "";

afterEach(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

describe("OpenViking Pi package loader", () => {
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

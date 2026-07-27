import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, createAgentSessionFromServices } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { projectExtensionCatalog } from "./extension-catalog.js";
import { projectExtensionCommands } from "./extension-commands.js";
import { createDesktopSessionServices } from "./session-services.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Pi extension command resolution contract", () => {
  it("uses Pi's collision-resolved invocation names and hides the Desktop policy extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-extension-commands-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    const extensionsDirectory = join(agentDir, "extensions");
    await Promise.all([mkdir(cwd), mkdir(extensionsDirectory, { recursive: true })]);
    await Promise.all([
      writeExtension(join(extensionsDirectory, "alpha.ts"), "Alpha command"),
      writeExtension(join(extensionsDirectory, "beta.ts"), "Beta command")
    ]);

    const services = await createDesktopSessionServices({
      cwd,
      agentDir,
      runtimeApiKeys: new Map(),
      getSafety: () => ({ cwd, trust: "trusted", approvalMode: "guided" }),
      requestApproval: async () => false
    });
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(cwd)
    });
    try {
      const extensions = services.resourceLoader.getExtensions();
      expect(projectExtensionCommands(extensions)).toEqual([
        { name: "duplicate:1", description: "Alpha command" },
        { name: "duplicate:2", description: "Beta command" }
      ]);
      const catalog = projectExtensionCatalog(extensions);
      expect(catalog.items.map((item) => item.label)).toEqual(expect.arrayContaining([
        expect.stringContaining("alpha.ts"),
        expect.stringContaining("beta.ts")
      ]));
      expect(catalog.items.some((item) => item.id.includes("pi67-desktop-safety"))).toBe(false);
    } finally {
      session.dispose();
    }
  }, 15_000);
});

function writeExtension(path: string, description: string): Promise<void> {
  return writeFile(path, `
    export default function register(pi) {
      pi.registerCommand("duplicate", {
        description: ${JSON.stringify(description)},
        handler: async () => undefined
      });
    }
  `, "utf8");
}

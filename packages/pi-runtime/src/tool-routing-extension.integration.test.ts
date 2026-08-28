import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionManager,
  SettingsManager,
  createAgentSessionFromServices
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopExtensionUiBridge } from "./extension-ui-bridge.js";
import { createDesktopPackageSettingsView } from "./desktop-package-toolchain.js";
import { createDesktopSessionServices } from "./session-services.js";
import { createDesktopToolAliasBinding } from "./tool-routing-extension.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Desktop tool routing Extension integration", () => {
  it("forwards verified built-in aliases and disables an alias with an unverified canonical source", async () => {
    const fixture = await createFixture("unverified-web-extension");
    const extensionsDirectory = join(fixture.agentDir, "extensions");
    await mkdir(extensionsDirectory, { recursive: true });
    await writeFile(join(extensionsDirectory, "web-search.ts"), `
      import { Type } from "typebox";
      export default function register(pi) {
        pi.registerTool({
          name: "web_search",
          label: "Web search",
          description: "Unverified fixture",
          parameters: Type.Object({ query: Type.String() }),
          async execute() { return { content: [{ type: "text", text: "fixture" }] }; }
        });
      }
    `, "utf8");

    const { session, bridge, requestApproval } = await createSession(fixture);
    try {
      expect(session.extensionRunner.getActiveTools()).toContain("web_search");
      expect(session.getActiveToolNames()).toContain("Bash");
      expect(session.getActiveToolNames()).not.toContain("WebSearch");

      const beforeStart = await session.extensionRunner.emitBeforeAgentStart(
        "inspect the workspace",
        undefined,
        "base prompt",
        { cwd: fixture.cwd }
      );
      expect(beforeStart?.systemPrompt).toContain("`Bash`→`bash`");
      expect(beforeStart?.systemPrompt).not.toContain("`WebSearch`→`web_search`");

      const bashAlias = session.getToolDefinition("Bash");
      if (!bashAlias?.prepareArguments) throw new Error("Expected the verified Bash alias.");
      const bashInput = bashAlias.prepareArguments({ command: "printf pi67-alias" });
      await expect(session.extensionRunner.emitToolCall({
        type: "tool_call",
        toolCallId: "bash-alias-call",
        toolName: "Bash",
        input: bashInput as { command: string; timeout?: number }
      })).resolves.toBeUndefined();
      expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
        toolCallId: "bash-alias-call",
        toolName: "bash"
      }), expect.any(Object));
    } finally {
      bridge.dispose();
      session.dispose();
    }
  }, 15_000);

  it("excludes retired web Extensions before Pi resource load", async () => {
    const fixture = await createFixture("retired-web-extension");
    const packageDirectory = join(fixture.agentDir, "npm", "node_modules", "pi-web-access");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "package.json"), `${JSON.stringify({
      name: "pi-web-access",
      version: "0.17.0",
      type: "module",
      pi: { extensions: ["index.ts"] }
    }, null, 2)}\n`, "utf8");
    await writeFile(join(packageDirectory, "index.ts"), `
      import { Type } from "typebox";
      export default function register(pi) {
        pi.registerTool({
          name: "web_search",
          label: "Web search",
          description: "Must not load",
          parameters: Type.Object({ query: Type.String() }),
          async execute() { return { content: [{ type: "text", text: "unexpected" }] }; }
        });
      }
    `, "utf8");
    await writeFile(join(fixture.agentDir, "settings.json"), `${JSON.stringify({
      packages: ["npm:pi-web-access@0.17.0"]
    }, null, 2)}\n`, "utf8");

    const { session, bridge } = await createSession(fixture);
    try {
      expect(session.extensionRunner.getActiveTools()).not.toContain("web_search");
      expect(session.getActiveToolNames()).not.toContain("WebSearch");
      expect(session.getAllTools().some((tool) => tool.sourceInfo.source.includes("pi-web-access"))).toBe(false);
    } finally {
      bridge.dispose();
      session.dispose();
    }
  }, 15_000);

  it("does not expose the optional SDK PowerShell Tool without a Desktop safety contract", async () => {
    const fixture = await createFixture("powershell-tool-policy");
    await writeFile(join(fixture.agentDir, "settings.json"), `${JSON.stringify({
      defaultTools: ["read", "powershell"]
    }, null, 2)}\n`, "utf8");

    const { session, bridge } = await createSession(fixture);
    try {
      expect(session.getActiveToolNames()).not.toContain("powershell");
      expect(session.getAllTools().map((tool) => tool.name)).not.toContain("powershell");
    } finally {
      bridge.dispose();
      session.dispose();
    }
  }, 15_000);
});

async function createFixture(name: string): Promise<{ cwd: string; agentDir: string }> {
  const root = await mkdtemp(join(tmpdir(), `pi67-${name}-`));
  temporaryDirectories.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  return { cwd, agentDir };
}

async function createSession(fixture: { cwd: string; agentDir: string }) {
  const requestApproval = vi.fn(async () => ({ status: "allowed" as const }));
  const settingsManager = createDesktopPackageSettingsView(
    SettingsManager.create(fixture.cwd, fixture.agentDir),
    { PI67_DESKTOP: "1" }
  );
  const services = await createDesktopSessionServices({
    cwd: fixture.cwd,
    agentDir: fixture.agentDir,
    settingsManager,
    runtimeApiKeys: new Map(),
    getSafety: () => ({ cwd: fixture.cwd, trust: "trusted", approvalMode: "guided", taskToolMode: "ask" }),
    requestApproval
  });
  const aliases = createDesktopToolAliasBinding();
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(fixture.cwd),
    customTools: aliases.tools,
    excludeTools: ["powershell"]
  });
  aliases.bind(session);
  const bridge = new DesktopExtensionUiBridge(() => undefined);
  await session.bindExtensions({ uiContext: bridge.context, mode: "rpc" });
  aliases.reconcile();
  return { session, bridge, requestApproval };
}

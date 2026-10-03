import { execFile as execFileCallback } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  assertPackagedRuntimeAssets,
  cleanupPackagedTestDirectories,
  createPackagedTestDirectories,
  installWorkspaceDialogResult,
  launchPackagedApplication,
  resolvePackagedArtifact
} from "./packaged-electron-fixture.mjs";
import { probePackagedMcpServer } from "./packaged-mcp-client.mjs";

const execFile = promisify(execFileCallback);
const artifact = resolvePackagedArtifact();
await assertPackagedRuntimeAssets(artifact);
const directories = await createPackagedTestDirectories("pi67-packaged-browser67-live-");
const { agentDir, userDataDirectory, workspace } = directories;
let application;

try {
  const retiredBrowser67Root = join(homedir(), ".agents", "packages", "browser67");
  await Promise.all([
    writeFile(`${agentDir}/mcp.json`, `${JSON.stringify({
      settings: { toolPrefix: "server" },
      mcpServers: {
        retained_fixture: { command: "retained-fixture" },
        tmwd_browser: {
          command: "node",
          args: [join(retiredBrowser67Root, "src", "mcp", "browser", "server.mjs")]
        },
        "js-reverse": {
          command: "node",
          args: [join(retiredBrowser67Root, "src", "mcp", "js-reverse", "server.mjs")]
        }
      }
    }, null, 2)}\n`, "utf8"),
    writeFile(`${agentDir}/mcp-cache.json`, "{legacy adapter cache bytes}\n", "utf8")
  ]);
  application = await launchPackagedApplication({
    agentDir,
    artifact,
    userDataDirectory
  });
  const window = await application.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "选择工作区" })
    .waitFor({ state: "visible", timeout: 15_000 });
  await window.evaluate(() => window.pi67.system.connectAgentHost());
  await installWorkspaceDialogResult(application, workspace);
  await window.getByRole("button", { name: "选择工作区" }).click();
  await window.getByLabel("当前状态：就绪")
    .waitFor({ state: "visible", timeout: 30_000 });

  const mcpConfig = await readJson(`${agentDir}/mcp.json`);
  assert(mcpConfig.pi67ManagedMcp?.schema === "pi67.browser67-mcp.v1", "managed MCP receipt is missing");
  assert(mcpConfig.mcpServers?.retained_fixture?.command === "retained-fixture", "unrelated MCP config was not preserved");
  assert(mcpConfig.mcpServers?.tmwd_browser?.exposure === "direct", "tmwd_browser was not directly exposed");
  assert(mcpConfig.mcpServers?.["js-reverse"]?.exposure === "deferred", "js-reverse was not deferred");
  assert(
    await readFile(`${agentDir}/mcp-cache.json`, "utf8") === "{legacy adapter cache bytes}\n",
    "legacy adapter cache bytes were changed"
  );
  const browser67Root = join(artifact.resourcesPath, "capabilities", "packages", "browser67");
  const tmwdBrowserEntrypoint = mcpConfig.mcpServers?.tmwd_browser?.args?.[0];
  assert(
    typeof tmwdBrowserEntrypoint === "string"
      && resolve(dirname(tmwdBrowserEntrypoint), "../../..") === resolve(browser67Root),
    "managed MCP did not migrate browser67 to the packaged capability root"
  );
  const browser67Package = await readJson(`${browser67Root}/package.json`);
  assert(browser67Package.version === "0.11.4", "unexpected browser67 version");
  assert(/^[0-9a-f]{40}$/u.test(browser67Package.gitHead), "browser67 gitHead is missing");

  const tmwdBrowser = await probePackagedMcpServer({
    name: "tmwd_browser",
    spec: mcpConfig.mcpServers?.tmwd_browser,
    expectedServerName: "browser67-tmwd-browser",
    toolName: "browser_transport_health",
    toolArguments: { tmwd_transport: "auto", timeout_ms: 3_000 },
    cwd: workspace
  });
  assert(tmwdBrowser.outcome.ok === true, "tmwd_browser health call failed");
  assert(tmwdBrowser.outcome.data?.ok === true, "tmwd_browser transport is not ready");
  assert(tmwdBrowser.outcome.data?.status !== "broken", "tmwd_browser transport is broken");

  const jsReverse = await probePackagedMcpServer({
    name: "js-reverse",
    spec: mcpConfig.mcpServers?.["js-reverse"],
    expectedServerName: "js-reverse",
    toolName: "check_browser_health",
    toolArguments: {},
    cwd: workspace
  });
  assert(jsReverse.outcome.ok === true, "js-reverse health call failed");
  assert(jsReverse.outcome.data?.ok === true, "js-reverse browser health failed");
  assert(jsReverse.outcome.data?.readiness?.ready === true, "js-reverse found no live browser pages");

  const doctor = await runPackagedDoctor({
    nodeExecutable: mcpConfig.mcpServers.tmwd_browser.command,
    browser67Root
  });
  assert(doctor.ok === true && doctor.stage === "doctor_only", "packaged browser67 doctor failed");
  assert(doctor.doctor?.readiness?.ready === true, "packaged browser67 doctor is not ready");
  assert(doctor.doctor?.checks?.tmwd_ws_runtime?.detail === "extension_identity_ok", "packaged WS identity failed");
  assert(doctor.doctor?.checks?.tmwd_ws_runtime?.identity_match === true, "packaged extension identity mismatch");

  process.stdout.write(`${JSON.stringify({
    schema: "pi67.packaged-browser67-live-smoke.v1",
    ok: true,
    platform: process.platform,
    architecture: process.arch,
    temporaryAgentProfile: true,
    browser67: {
      version: browser67Package.version,
      gitHead: browser67Package.gitHead,
      extensionIdentity: doctor.doctor.checks.tmwd_ws_runtime.detail,
      identityMatch: doctor.doctor.checks.tmwd_ws_runtime.identity_match
    },
    mcp: {
      tmwd_browser: {
        server: tmwdBrowser.serverInfo,
        toolCount: tmwdBrowser.toolCount,
        health: tmwdBrowser.outcome.data.status,
        preferredTransport: tmwdBrowser.outcome.data.preferred_transport
      },
      "js-reverse": {
        server: jsReverse.serverInfo,
        toolCount: jsReverse.toolCount,
        ready: jsReverse.outcome.data.readiness.ready,
        pagesCount: jsReverse.outcome.data.pages_count,
        transport: jsReverse.outcome.data.transport
      }
    }
  })}\n`);
} finally {
  if (application) await application.close().catch(() => undefined);
  await cleanupPackagedTestDirectories(userDataDirectory);
}

async function runPackagedDoctor({ nodeExecutable, browser67Root }) {
  const result = await execFile(nodeExecutable, [
    `${browser67Root}/contracts/browser67-live-gate.mjs`,
    "--doctor-only",
    "--tmwd-mode",
    "tmwd",
    "--tmwd-transport",
    "auto",
    "--disable-event-log"
  ], {
    cwd: browser67Root,
    env: {
      ...process.env,
      BROWSER67_EXTENSION_BUILD_REVISION: "",
      GITHUB_SHA: "",
      GIT_CEILING_DIRECTORIES: dirname(resolve(browser67Root))
    },
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000
  });
  return JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

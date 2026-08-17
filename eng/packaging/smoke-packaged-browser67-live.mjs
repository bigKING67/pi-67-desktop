import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
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
  await window.getByLabel("当前状态：Pi SDK 已就绪")
    .waitFor({ state: "visible", timeout: 30_000 });

  const mcpConfig = await readJson(`${agentDir}/mcp.json`);
  assert(mcpConfig.pi67ManagedMcp?.schema === "pi67.browser67-mcp.v1", "managed MCP receipt is missing");
  const browser67Root = join(artifact.resourcesPath, "capabilities", "packages", "browser67");
  const tmwdBrowserEntrypoint = mcpConfig.mcpServers?.tmwd_browser?.args?.[0];
  assert(
    typeof tmwdBrowserEntrypoint === "string"
      && resolve(dirname(tmwdBrowserEntrypoint), "../../..") === resolve(browser67Root),
    "managed MCP did not resolve browser67 from the packaged capability root"
  );
  const browser67Package = await readJson(`${browser67Root}/package.json`);
  assert(browser67Package.version === "0.4.0", "unexpected browser67 version");
  assert(/^[0-9a-f]{40}$/u.test(browser67Package.gitHead), "browser67 gitHead is missing");

  const managedBundleRoot = join(artifact.resourcesPath, "capabilities", "managed-packages", "bundled");
  const managedManifest = await readJson(join(managedBundleRoot, "manifest.json"));
  const managedState = await readJson(`${agentDir}/desktop-capabilities/managed-packages/state.json`);
  const managedPackages = Object.fromEntries(managedManifest.packages.map((entry) => [entry.id, entry]));
  assertManagedPackage(managedPackages, managedState, "pi-mcp-adapter", "2.11.0");
  assertManagedPackage(managedPackages, managedState, "pi-observational-memory", "3.0.3");

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
    managedPackages: {
      "pi-mcp-adapter": managedPackages["pi-mcp-adapter"].version,
      "pi-observational-memory": managedPackages["pi-observational-memory"].version
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
    env: { ...process.env },
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000
  });
  return JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
}

function assertManagedPackage(packages, state, id, version) {
  assert(packages[id]?.version === version, `${id}@${version} is not active`);
  assert(state.enabled[id] === true, `${id} is disabled`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

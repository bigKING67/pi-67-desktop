import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";
import { gte as semverGreaterThanOrEqual, valid as validSemver } from "semver";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export const packagedAttachmentRequiredAsarPaths = [
  "apps/agent-host/dist/prompt-attachment-worker.mjs",
  "apps/agent-host/dist/skill-pack-process-worker.mjs",
  "node_modules/mediainfo.js/dist/MediaInfoModule.wasm",
  "node_modules/officeparser/package.json",
  "node_modules/officeparser/dist/index.mjs",
  "node_modules/tesseract.js/src/worker-script/node/index.js",
  "node_modules/tesseract.js-core/tesseract-core.js",
  "node_modules/tesseract.js-core/tesseract-core.wasm",
  "node_modules/tesseract.js-core/tesseract-core-simd.js",
  "node_modules/tesseract.js-core/tesseract-core-simd.wasm",
  "node_modules/tesseract.js-core/tesseract-core-relaxedsimd.js",
  "node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm",
  "node_modules/tesseract.js-core/tesseract-core-lstm.js",
  "node_modules/tesseract.js-core/tesseract-core-lstm.wasm",
  "node_modules/tesseract.js-core/tesseract-core-simd-lstm.js",
  "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm",
  "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.js",
  "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm",
  "node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
  "node_modules/@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz"
];

export const packagedAttachmentExcludedAsarPaths = [
  "node_modules/tesseract.js-core/tesseract-core.wasm.js",
  "node_modules/tesseract.js-core/tesseract-core-simd.wasm.js",
  "node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm.js",
  "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
  "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  "node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz",
  "node_modules/officeparser/dist/officeparser.browser.iife.js",
  "node_modules/officeparser/dist/officeparser.browser.mjs",
  "node_modules/officeparser/dist/officeparser.browser.slim.iife.js",
  "node_modules/officeparser/dist/officeparser.browser.slim.mjs"
];

const PACKAGE_WORKER_ASAR_PATH = "apps/agent-host/dist/skill-pack-process-worker.mjs";
export const WINDOWS_PACKAGE_WORKER_ISOLATION_VERSION = "0.1.0-alpha.24";

export function resolvePackagedRuntimeAssetContract(version) {
  if (!validSemver(version)) {
    throw new Error(`Invalid version for packaged Runtime asset contract: ${String(version)}.`);
  }
  const packageWorkerIsolated = semverGreaterThanOrEqual(
    version,
    WINDOWS_PACKAGE_WORKER_ISOLATION_VERSION
  );
  return {
    packageWorkerIsolated,
    requiredAsarPaths: packageWorkerIsolated
      ? packagedAttachmentRequiredAsarPaths
      : packagedAttachmentRequiredAsarPaths.filter((path) => path !== PACKAGE_WORKER_ASAR_PATH),
    requireWindowsPackageWorkerJob: packageWorkerIsolated
  };
}

export function resolvePackagedArtifact(platform = process.platform, arch = process.arch) {
  const supportedHost = (platform === "darwin" && arch === "arm64")
    || (platform === "win32" && arch === "x64");
  if (!supportedHost) throw new Error(`Packaged Electron fixture does not support ${platform}/${arch}.`);

  const packagedRoot = platform === "darwin"
    ? join(repositoryRoot, "artifacts/release/mac-arm64/Pi-67 Desktop.app/Contents")
    : join(repositoryRoot, "artifacts/release/win-unpacked");
  const resourcesPath = platform === "darwin"
    ? join(packagedRoot, "Resources")
    : join(packagedRoot, "resources");
  return {
    arch,
    executablePath: platform === "darwin"
      ? join(packagedRoot, "MacOS/Pi-67 Desktop")
      : join(packagedRoot, "Pi-67 Desktop.exe"),
    platform,
    resourcesPath
  };
}

export async function assertPackagedRuntimeAssets(artifact, {
  requiredAsarPaths = packagedAttachmentRequiredAsarPaths,
  requireWindowsPackageWorkerJob = true
} = {}) {
  const clipboardModule = artifact.platform === "darwin"
    ? "@mariozechner/clipboard-darwin-arm64/clipboard.darwin-arm64.node"
    : "@mariozechner/clipboard-win32-x64-msvc/clipboard.win32-x64-msvc.node";
  const unpackedModules = join(artifact.resourcesPath, "app.asar.unpacked/node_modules");
  const canvasModule = artifact.platform === "darwin"
    ? "@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node"
    : "@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node";
  await Promise.all([
    access(artifact.executablePath),
    access(join(unpackedModules, clipboardModule)),
    access(join(unpackedModules, "@silvia-odwyer/photon-node/photon_rs_bg.wasm")),
    access(join(unpackedModules, canvasModule)),
    access(join(artifact.resourcesPath, "toolchain/manifest.json")),
    access(join(artifact.resourcesPath, "capabilities/manifest.json")),
    access(join(artifact.resourcesPath, "capabilities/catalog.json")),
    access(join(artifact.resourcesPath, "capabilities/packages/pi67-core/package.json")),
    access(join(artifact.resourcesPath, "capabilities/packages/browser67/package.json")),
    access(join(artifact.resourcesPath, "capabilities/packages/browser67/node_modules/ajv/package.json")),
    access(join(artifact.resourcesPath, "capabilities/packages/browser67/node_modules/ws/package.json")),
    access(join(artifact.resourcesPath, "capabilities/packages/design-craft/package.json")),
    access(join(artifact.resourcesPath, "capabilities/packages/commerce-growth-os/package.json")),
    access(join(artifact.resourcesPath, "capabilities/managed-packages/bundled/manifest.json")),
    access(join(artifact.resourcesPath, "capabilities/managed-packages/bundled/packages/pi-mcp-adapter/package.json")),
    access(join(artifact.resourcesPath, "capabilities/managed-packages/bundled/packages/pi-observational-memory/package.json")),
    ...(artifact.platform === "win32" && requireWindowsPackageWorkerJob
      ? [access(join(artifact.resourcesPath, "native/pi67-package-worker-job.exe"))]
      : []),
    assertPackagedAsarContract(artifact, requiredAsarPaths)
  ]);
}

function assertPackagedAsarContract(artifact, requiredAsarPaths) {
  const script = [
    "const { accessSync } = require('node:fs');",
    "const { join } = require('node:path');",
    "const root = process.argv[1];",
    "for (const path of JSON.parse(process.argv[2])) accessSync(join(root, 'app.asar', path));",
    "for (const path of JSON.parse(process.argv[3])) {",
    "  try { accessSync(join(root, 'app.asar', path)); }",
    "  catch (error) { if (error && error.code === 'ENOENT') continue; throw error; }",
    "  throw new Error('Unexpected packaged path: ' + path);",
    "}"
  ].join(" ");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(artifact.executablePath, [
      "-e",
      script,
      artifact.resourcesPath,
      JSON.stringify(requiredAsarPaths),
      JSON.stringify(packagedAttachmentExcludedAsarPaths)
    ], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Packaged attachment asset probe terminated by ${signal}.`));
      else if (code !== 0) reject(new Error(`Packaged attachment asset probe exited ${code ?? 1}.`));
      else resolvePromise();
    });
  });
}

export async function createPackagedTestDirectories(prefix, workspaceName = "workspace") {
  const userDataDirectory = await mkdtemp(join(tmpdir(), prefix));
  const workspace = join(userDataDirectory, workspaceName);
  const agentDir = join(userDataDirectory, "agent");
  const extensionsDirectory = join(agentDir, "extensions");
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(extensionsDirectory, { recursive: true })
  ]);
  return { agentDir, extensionsDirectory, userDataDirectory, workspace };
}

export async function launchPackagedApplication({
  agentDir,
  applicationArguments = [],
  artifact,
  environment = {},
  hideNativeWindow = true,
  isolateNativeWindow = false,
  offline = true,
  probePackagedRendererIsolation = true,
  userDataDirectory
}) {
  const application = await electron.launch({
    executablePath: artifact.executablePath,
    args: [...applicationArguments, `--user-data-dir=${userDataDirectory}`],
    env: packagedApplicationEnvironment({
      agentDir,
      environment,
      offline,
      probePackagedRendererIsolation
    })
  });
  if (isolateNativeWindow) {
    await isolatePackagedAutomationWindow(application, { hideNativeWindow });
  }
  return application;
}

export async function isolatePackagedAutomationWindow(
  application,
  { hideNativeWindow = true } = {}
) {
  await application.firstWindow();
  await application.evaluate(({ BrowserWindow }, shouldHideNativeWindow) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Packaged BrowserWindow is unavailable.");

    window.webContents.setBackgroundThrottling(false);
    window.setIgnoreMouseEvents(true);
    window.setFocusable(false);
    if (!shouldHideNativeWindow) return;

    const keepHidden = () => {
      if (!window.isDestroyed()) window.hide();
    };
    window.on("show", keepHidden);
    keepHidden();
  }, hideNativeWindow);
}

export function packagedApplicationEnvironment({
  agentDir,
  environment = {},
  hostEnvironment = process.env,
  offline = true,
  probePackagedRendererIsolation = true
}) {
  const baseEnvironment = { ...hostEnvironment };
  delete baseEnvironment.PI67_RENDERER_DEV_URL;
  const applicationEnvironment = {
    ...baseEnvironment,
    NODE_ENV: "test",
    PI_CODING_AGENT_DIR: agentDir,
    ...(probePackagedRendererIsolation
      ? { PI67_RENDERER_DEV_URL: "https://renderer.invalid/" }
      : {}),
    ...environment
  };
  if (offline) applicationEnvironment.PI_OFFLINE = "1";
  else delete applicationEnvironment.PI_OFFLINE;
  return applicationEnvironment;
}

export async function installWorkspaceDialogResult(application, workspace) {
  await application.evaluate(({ dialog }, selectedWorkspace) => {
    Object.defineProperty(dialog, "showOpenDialog", {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedWorkspace] })
    });
  }, workspace);
}

export async function installSaveDialogResult(application, filePath) {
  await application.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, "showSaveDialog", {
      configurable: true,
      value: async () => ({ canceled: false, filePath: selectedPath })
    });
  }, filePath);
}

export async function setPackagedContentSize(application, width, height) {
  await application.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Packaged BrowserWindow is unavailable.");
    window.setContentSize(size.width, size.height);
  }, { height, width });
}

export async function cleanupPackagedTestDirectories(userDataDirectory) {
  await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

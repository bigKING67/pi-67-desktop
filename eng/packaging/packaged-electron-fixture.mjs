import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

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

export async function assertPackagedRuntimeAssets(artifact) {
  const clipboardModule = artifact.platform === "darwin"
    ? "@mariozechner/clipboard-darwin-arm64/clipboard.darwin-arm64.node"
    : "@mariozechner/clipboard-win32-x64-msvc/clipboard.win32-x64-msvc.node";
  const unpackedModules = join(artifact.resourcesPath, "app.asar.unpacked/node_modules");
  await Promise.all([
    access(artifact.executablePath),
    access(join(unpackedModules, clipboardModule)),
    access(join(unpackedModules, "@silvia-odwyer/photon-node/photon_rs_bg.wasm"))
  ]);
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

export function launchPackagedApplication({
  agentDir,
  applicationArguments = [],
  artifact,
  environment = {},
  probePackagedRendererIsolation = true,
  userDataDirectory
}) {
  return electron.launch({
    executablePath: artifact.executablePath,
    args: [...applicationArguments, `--user-data-dir=${userDataDirectory}`],
    env: packagedApplicationEnvironment({
      agentDir,
      environment,
      probePackagedRendererIsolation
    })
  });
}

export function packagedApplicationEnvironment({
  agentDir,
  environment = {},
  hostEnvironment = process.env,
  probePackagedRendererIsolation = true
}) {
  const baseEnvironment = { ...hostEnvironment };
  delete baseEnvironment.PI67_RENDERER_DEV_URL;
  return {
    ...baseEnvironment,
    NODE_ENV: "test",
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    ...(probePackagedRendererIsolation
      ? { PI67_RENDERER_DEV_URL: "https://renderer.invalid/" }
      : {}),
    ...environment
  };
}

export async function installWorkspaceDialogResult(application, workspace) {
  await application.evaluate(({ dialog }, selectedWorkspace) => {
    Object.defineProperty(dialog, "showOpenDialog", {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedWorkspace] })
    });
  }, workspace);
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

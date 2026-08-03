import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type Browser67BrowserId = "chrome" | "edge";

interface Browser67PathOptions {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  pathExists?: (path: string) => boolean;
}

interface Browser67BrowserOptions extends Browser67PathOptions {
  platform?: NodeJS.Platform;
}

export function resolveBrowser67Home(options: Browser67PathOptions = {}): string {
  const environment = options.environment ?? process.env;
  const homeDirectory = resolve(options.homeDirectory ?? homedir());
  const pathExists = options.pathExists ?? existsSync;
  const configured = firstNonEmpty(environment.BROWSER67_HOME, environment.TMWD_BROWSER_MCP_HOME);
  if (configured) return resolve(expandHome(configured, homeDirectory));
  const canonical = join(homeDirectory, ".browser67");
  const legacy = join(homeDirectory, ".tmwd-browser-mcp");
  if (pathExists(canonical)) return canonical;
  if (pathExists(legacy)) return legacy;
  return canonical;
}

export function resolveBrowser67ExtensionDirectory(options: Browser67PathOptions = {}): string {
  return join(resolveBrowser67Home(options), "browser", "tmwd_cdp_bridge");
}

export function detectBrowser67Browsers(options: Browser67BrowserOptions = {}): Browser67BrowserId[] {
  const platform = options.platform ?? process.platform;
  const candidates = browserCandidates({ ...options, platform });
  const pathExists = options.pathExists ?? existsSync;
  return (["chrome", "edge"] as const).filter((browser) => (
    candidates[browser].some((path) => pathExists(path))
  ));
}

export async function openBrowser67ExtensionPage(
  browser: Browser67BrowserId,
  options: Browser67BrowserOptions & {
    launch?: (executable: string, url: string) => Promise<void>;
  } = {}
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const pathExists = options.pathExists ?? existsSync;
  const executable = browserCandidates({ ...options, platform })[browser]
    .find((path) => pathExists(path));
  if (!executable) return false;
  const launch = options.launch ?? launchDetached;
  await launch(executable, browser === "chrome" ? "chrome://extensions" : "edge://extensions");
  return true;
}

export async function assertSafeBrowser67ExtensionTarget(
  home: string,
  extensionDirectory: string,
  options: { requireManifest: boolean }
): Promise<string> {
  const normalizedHome = resolve(home);
  const normalizedExtension = resolve(extensionDirectory);
  if (!isContained(normalizedExtension, normalizedHome)) {
    throw new Error("browser67 extension target escaped the active home.");
  }
  for (const candidate of [normalizedHome, dirname(normalizedExtension), normalizedExtension]) {
    if (!existsSync(candidate)) continue;
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("browser67 extension target is not a safe directory.");
    }
  }
  const manifestPath = join(normalizedExtension, "manifest.json");
  if (!options.requireManifest) return manifestPath;
  const [realHome, realExtension, manifest] = await Promise.all([
    realpath(normalizedHome),
    realpath(normalizedExtension),
    lstat(manifestPath)
  ]);
  if (!isContained(realExtension, realHome) || manifest.isSymbolicLink() || !manifest.isFile()) {
    throw new Error("browser67 extension installation is invalid.");
  }
  return manifestPath;
}

function browserCandidates(options: Browser67BrowserOptions & { platform: NodeJS.Platform }): Record<Browser67BrowserId, string[]> {
  const homeDirectory = resolve(options.homeDirectory ?? homedir());
  const environment = options.environment ?? process.env;
  if (options.platform === "darwin") {
    return {
      chrome: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        join(homeDirectory, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
      ],
      edge: [
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        join(homeDirectory, "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
      ]
    };
  }
  if (options.platform === "win32") {
    const programFiles = uniqueNonEmpty([
      environment.ProgramFiles,
      environment["ProgramFiles(x86)"],
      environment.LOCALAPPDATA
    ]);
    return {
      chrome: programFiles.map((root) => join(root, "Google", "Chrome", "Application", "chrome.exe")),
      edge: programFiles.map((root) => join(root, "Microsoft", "Edge", "Application", "msedge.exe"))
    };
  }
  return { chrome: [], edge: [] };
}

function launchDetached(executable: string, url: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [url], {
      detached: true,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

function expandHome(path: string, homeDirectory: string): string {
  if (path === "~") return homeDirectory;
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homeDirectory, path.slice(2));
  return path;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function isContained(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate) || !isAbsolute(root)) return false;
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLowerCase()
    : (value: string) => resolve(value);
  const fromRoot = relative(normalize(root), normalize(candidate));
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

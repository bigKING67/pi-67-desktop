import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeBrowser67ExtensionTarget,
  detectBrowser67Browsers,
  openBrowser67ExtensionPage,
  resolveBrowser67ExtensionDirectory,
  resolveBrowser67Home
} from "./browser67-integration.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("browser67 Desktop integration", () => {
  it("uses configured and existing homes in canonical precedence order", () => {
    const home = resolve("/tmp/pi67-browser-home");
    expect(resolveBrowser67Home({
      environment: { BROWSER67_HOME: "~/configured", TMWD_BROWSER_MCP_HOME: "~/legacy-configured" },
      homeDirectory: home,
      pathExists: () => false
    })).toBe(join(home, "configured"));
    expect(resolveBrowser67Home({
      environment: { TMWD_BROWSER_MCP_HOME: "~/legacy-configured" },
      homeDirectory: home,
      pathExists: () => false
    })).toBe(join(home, "legacy-configured"));
    expect(resolveBrowser67Home({
      environment: {},
      homeDirectory: home,
      pathExists: (path) => path.endsWith(".tmwd-browser-mcp")
    })).toBe(join(home, ".tmwd-browser-mcp"));
    expect(resolveBrowser67ExtensionDirectory({
      environment: {},
      homeDirectory: home,
      pathExists: () => false
    })).toBe(join(home, ".browser67", "browser", "tmwd_cdp_bridge"));
  });

  it("detects standard macOS Chrome and Edge installations", () => {
    const installed = new Set([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ]);
    expect(detectBrowser67Browsers({
      platform: "darwin",
      homeDirectory: "/Users/example",
      pathExists: (path) => installed.has(path)
    })).toEqual(["chrome", "edge"]);
  });

  it("detects standard Windows Chrome and Edge installations", () => {
    expect(detectBrowser67Browsers({
      platform: "win32",
      environment: {
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local"
      },
      pathExists: (path) => {
        const normalized = path.replaceAll("\\", "/");
        return normalized.endsWith("/Google/Chrome/Application/chrome.exe")
          || normalized.endsWith("/Microsoft/Edge/Application/msedge.exe");
      }
    })).toEqual(["chrome", "edge"]);
  });

  it("opens only the fixed extension-management URL for an installed browser", async () => {
    const launch = vi.fn(async () => undefined);
    expect(await openBrowser67ExtensionPage("chrome", {
      platform: "darwin",
      pathExists: (path) => path.startsWith("/Applications/Google Chrome.app"),
      launch
    })).toBe(true);
    expect(launch).toHaveBeenCalledWith(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "chrome://extensions"
    );

    launch.mockClear();
    expect(await openBrowser67ExtensionPage("edge", {
      platform: "linux",
      pathExists: () => true,
      launch
    })).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });

  it("rejects escaped and symbolic-link extension targets", async () => {
    const root = await createTemporaryRoot();
    const home = join(root, "home");
    const outside = join(root, "outside");
    await mkdir(home, { recursive: true });
    await mkdir(outside, { recursive: true });
    await expect(assertSafeBrowser67ExtensionTarget(home, outside, { requireManifest: false }))
      .rejects.toThrow(/escaped the active home/u);

    const browserDirectory = join(home, "browser");
    await mkdir(browserDirectory, { recursive: true });
    const link = join(browserDirectory, "tmwd_cdp_bridge");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    await expect(assertSafeBrowser67ExtensionTarget(home, link, { requireManifest: false }))
      .rejects.toThrow(/not a safe directory/u);
  });

  it("returns a verified manifest path for a regular contained directory", async () => {
    const root = await createTemporaryRoot();
    const home = join(root, "home");
    const extension = join(home, "browser", "tmwd_cdp_bridge");
    await mkdir(extension, { recursive: true });
    await writeFile(join(extension, "manifest.json"), "{}", "utf8");
    await expect(assertSafeBrowser67ExtensionTarget(home, extension, { requireManifest: true }))
      .resolves.toBe(join(extension, "manifest.json"));
  });
});

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-browser67-integration-"));
  temporaryRoots.push(root);
  return root;
}

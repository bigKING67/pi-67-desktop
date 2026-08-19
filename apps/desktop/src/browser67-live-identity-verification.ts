import type {
  Browser67LiveDoctorResult,
  Browser67ProcessRunners
} from "./browser67-capability-process.js";
import type { DesktopToolchain } from "./desktop-toolchain.js";

export interface Browser67LiveIdentityVerification {
  live: Browser67LiveDoctorResult;
  extensionState: "connected" | "reload-required" | "prepared";
  detail: string;
}

export async function verifyBrowser67LiveIdentity(options: {
  packageRoot: string;
  ensureHub: boolean;
  toolchain: DesktopToolchain;
  runDoctor: Browser67ProcessRunners["runBrowserLiveDoctor"];
  runReload: Browser67ProcessRunners["runBrowserExtensionReload"];
}): Promise<Browser67LiveIdentityVerification> {
  let live = await options.runDoctor(options.packageRoot, options.ensureHub, options.toolchain);
  let reloadAttempted = false;
  let reloadFailed = false;
  if (options.ensureHub && live.extensionConnected && !live.identityMatch) {
    reloadAttempted = true;
    try {
      await options.runReload(options.packageRoot, options.toolchain);
      live = await options.runDoctor(options.packageRoot, true, options.toolchain);
    } catch {
      reloadFailed = true;
    }
  }
  const extensionState = live.ready
    ? "connected" as const
    : live.extensionConnected && !live.identityMatch
      ? "reload-required" as const
      : "prepared" as const;
  const detail = live.ready
    ? reloadAttempted
      ? "已复用并重新加载现有 browser67 扩展；身份与当前内置版本一致，真实受管浏览器连接已就绪。"
      : "browser67 扩展身份与当前内置版本一致，真实受管浏览器连接已就绪。"
    : reloadFailed
      ? "现有扩展文件是当前版本，但浏览器自动重新加载失败。请在扩展管理页点击该扩展的重新加载按钮后再次验证。"
      : reloadAttempted
        ? "浏览器已重新加载现有扩展，但身份仍不匹配。请核对加载来源；仅当来源不是 Pi-67 提供的目录时才移除并重新加载。"
        : live.detail;
  return { live, extensionState, detail };
}

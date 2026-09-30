import { gitSourceCandidates, npmRegistryCandidates, type PackageNetworkSettings } from "@pi67/protocol";
import { dialog, type BrowserWindow } from "electron";

/** Custom npm registries and Git mirror prefixes that take effect in `next` but not in `current`. */
export function newlyEffectiveCustomSources(
  current: PackageNetworkSettings,
  next: PackageNetworkSettings
): string[] {
  const before = new Set(effectiveCustomSources(current));
  return effectiveCustomSources(next).filter((source) => !before.has(source));
}

function effectiveCustomSources(settings: PackageNetworkSettings): string[] {
  return [
    ...npmRegistryCandidates(settings).filter((source) => source.role === "custom").map((source) => source.url),
    ...gitSourceCandidates(settings).flatMap((source) => (
      source.role === "custom" && source.insteadOfPrefix ? [source.insteadOfPrefix] : []
    ))
  ];
}

/**
 * Packages and GitHub fetches then come from these sources, and the Lark CLI install does not pin
 * integrity, so Main confirms a new custom source natively instead of trusting the renderer.
 */
export async function confirmCustomPackageSources(
  window: BrowserWindow | undefined,
  sources: readonly string[]
): Promise<boolean> {
  if (!window || window.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(window, {
    type: "warning",
    title: "使用自定义下载源？",
    message: "之后安装的扩展、技能和 Lark CLI 将从以下地址下载：",
    detail: `${sources.join("\n")}\n\n只在你信任这个下载源时继续。`,
    buttons: ["使用这个下载源", "取消"],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  return response === 0;
}

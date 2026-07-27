import type { Extension, LoadExtensionsResult, SourceInfo } from "@earendil-works/pi-coding-agent";
import type { ExtensionAdapterMatch } from "@pi67/extension-compat";
import {
  MAX_EXTENSION_CATALOG_DETAIL_CHARS,
  MAX_EXTENSION_CATALOG_ITEMS,
  MAX_EXTENSION_CATALOG_JSON_BYTES,
  MAX_EXTENSION_CATALOG_LABEL_CHARS,
  MAX_EXTENSION_CATALOG_PATH_CHARS,
  MAX_EXTENSION_SURFACE_DETAIL_CHARS,
  type ExtensionCatalogItem,
  type ExtensionCatalogResult,
  type ExtensionCompatibilityAssessment,
  type ExtensionAdapterMatchView,
  type ExtensionSourceRef,
  type ExtensionSurfaceAssessment
} from "@pi67/domain";
import { sanitizeRuntimeText } from "./runtime-redaction.js";
import { DESKTOP_SAFETY_EXTENSION_PATH } from "./safety-extension.js";

export function projectExtensionCatalog(
  extensions: LoadExtensionsResult | undefined,
  adapterMatches: ReadonlyMap<string, ExtensionAdapterMatch> = new Map()
): ExtensionCatalogResult {
  const candidates = [
    ...(extensions?.extensions ?? [])
      .filter((extension) => !extension.hidden)
      .map((extension) => projectLoadedExtension(extension, adapterMatches.get(extensionProjectionId(extension)))),
    ...(extensions?.errors ?? [])
      .filter((error) => error.path !== DESKTOP_SAFETY_EXTENSION_PATH)
      .map((error) => projectLoadError(error.path, error.error))
  ].sort(compareCatalogItems);
  const items = boundedCatalogItems(candidates);
  return {
    items,
    total: candidates.length,
    truncated: items.length < candidates.length
  };
}

function projectLoadedExtension(
  extension: Extension,
  adapterMatch: ExtensionAdapterMatch | undefined
): ExtensionCatalogItem {
  const commandCount = extension.commands.size;
  const toolCount = extension.tools.size;
  const customSurfaceCount = extension.messageRenderers.size
    + (extension.entryRenderers?.size ?? 0)
    + extension.shortcuts.size;
  const assessment = assessLoadedExtension(commandCount, toolCount, customSurfaceCount, adapterMatch);
  const path = nonEmptyBounded(extension.resolvedPath || extension.path, MAX_EXTENSION_CATALOG_PATH_CHARS);
  return {
    id: path,
    label: catalogLabel(extension),
    path,
    loadState: "loaded",
    source: projectSource(extension.sourceInfo),
    ...(adapterMatch === undefined ? {} : { adapter: projectAdapterMatch(adapterMatch) }),
    assessment,
    commandCount,
    toolCount
  };
}

function projectLoadError(path: string, error: string): ExtensionCatalogItem {
  const safePath = nonEmptyBounded(path, MAX_EXTENSION_CATALOG_PATH_CHARS - "error:".length);
  const detail = bounded(
    sanitizeRuntimeText(error, MAX_EXTENSION_CATALOG_DETAIL_CHARS),
    MAX_EXTENSION_CATALOG_DETAIL_CHARS
  );
  return {
    id: `error:${safePath}`,
    label: nonEmptyBounded(path, MAX_EXTENSION_CATALOG_LABEL_CHARS),
    path: safePath,
    loadState: "failed",
    assessment: {
      overall: "unsupported",
      detail,
      surfaces: allSurfaces("unsupported", "Extension 加载失败，Desktop 不会尝试执行其能力。")
    },
    commandCount: 0,
    toolCount: 0
  };
}

function assessLoadedExtension(
  commandCount: number,
  toolCount: number,
  customSurfaceCount: number,
  adapterMatch: ExtensionAdapterMatch | undefined
): ExtensionCompatibilityAssessment {
  const hasExecutableSurface = commandCount > 0 || toolCount > 0;
  const adaptedCommandCount = adapterMatch?.commands.length ?? 0;
  const adaptedToolCount = adapterMatch?.tools.length ?? 0;
  const allExecutableSurfacesAdapted = hasExecutableSurface
    && adaptedCommandCount === commandCount
    && adaptedToolCount === toolCount;
  const { overall, detail } = compatibilitySummary(
    hasExecutableSurface,
    customSurfaceCount,
    allExecutableSurfacesAdapted,
    adapterMatch !== undefined
  );
  return {
    overall,
    detail,
    surfaces: [
      surface(
        "commands",
        commandCount > 0 ? "supported" : "not-present",
        commandCount > 0
          ? adaptedCommandCount > 0
            ? `${commandCount} 个命令通过 Pi 的已解析命令目录调用，其中 ${adaptedCommandCount} 个带有已验证 Adapter 元数据。`
            : `${commandCount} 个命令通过 Pi 的已解析命令目录调用。`
          : "未注册命令。"
      ),
      surface(
        "tools",
        toolCount === 0 ? "not-present" : adaptedToolCount === toolCount ? "supported" : "partial",
        toolCount > 0
          ? adaptedToolCount > 0
            ? `${toolCount} 个工具可执行，其中 ${adaptedToolCount} 个使用已验证的声明式 Tool Adapter。`
            : `${toolCount} 个工具可执行，并使用 Desktop 内置或通用工具展示。`
          : "未注册工具。"
      ),
      surface(
        "ui-primitives",
        "unknown",
        "Pi SDK 共享 UIContext，Desktop 无法把实时 UI 调用可靠归属到此 Extension。"
      ),
      surface(
        "tui-custom",
        customSurfaceCount > 0 ? "tui-only" : "unknown",
        customSurfaceCount > 0
          ? `发现 ${customSurfaceCount} 个 TUI renderer 或快捷键注册；Desktop 不执行自定义组件。`
          : "未发现已注册的 renderer 或快捷键，但不能静态证明 Extension 不会调用 TUI-only API。"
      )
    ]
  };
}

function compatibilitySummary(
  hasExecutableSurface: boolean,
  customSurfaceCount: number,
  allExecutableSurfacesAdapted: boolean,
  hasAdapterMatch: boolean
): Pick<ExtensionCompatibilityAssessment, "overall" | "detail"> {
  if (customSurfaceCount > 0) {
    return {
      overall: hasExecutableSurface ? "partial" : "tui-only",
      detail: "已发现 Pi TUI 专用展示或快捷键；命令和工具仍按各自 surface 单独评估。"
    };
  }
  if (allExecutableSurfacesAdapted) {
    return {
      overall: "adapter",
      detail: "全部已发现的命令和工具 surface 均由已验证的声明式 Desktop Adapter 覆盖。"
    };
  }
  if (hasAdapterMatch) {
    return {
      overall: "partial",
      detail: "已验证的声明式 Desktop Adapter 覆盖了部分命令或工具；其余能力保持原生或通用展示。"
    };
  }
  return hasExecutableSurface
    ? {
      overall: "partial",
      detail: "命令或工具可用，但 Extension UI 的实时调用方无法由当前 Pi SDK 可靠归属。"
    }
    : {
      overall: "unknown",
      detail: "已加载，但没有足够的运行时证据声明为原生、无界面或已适配。"
    };
}

function projectAdapterMatch(match: ExtensionAdapterMatch): ExtensionAdapterMatchView {
  return {
    adapterId: match.adapterId,
    schemaVersion: match.schemaVersion,
    package: match.package,
    installedVersion: match.installedVersion,
    versionRange: match.versionRange,
    surfaces: [...match.surfaces],
    commandCount: match.commands.length,
    toolCount: match.tools.length
  };
}

function extensionProjectionId(extension: Extension): string {
  return extension.resolvedPath || extension.path || extension.sourceInfo.path;
}

function projectSource(source: SourceInfo): ExtensionSourceRef {
  return {
    path: nonEmptyBounded(source.path, MAX_EXTENSION_CATALOG_PATH_CHARS),
    source: nonEmptyBounded(source.source, MAX_EXTENSION_CATALOG_PATH_CHARS),
    scope: source.scope,
    origin: source.origin
  };
}

function allSurfaces(
  status: ExtensionSurfaceAssessment["status"],
  detail: string
): ExtensionSurfaceAssessment[] {
  return (["commands", "tools", "ui-primitives", "tui-custom"] as const)
    .map((surfaceName) => surface(surfaceName, status, detail));
}

function surface(
  surfaceName: ExtensionSurfaceAssessment["surface"],
  status: ExtensionSurfaceAssessment["status"],
  detail: string
): ExtensionSurfaceAssessment {
  return {
    surface: surfaceName,
    status,
    detail: bounded(detail, MAX_EXTENSION_SURFACE_DETAIL_CHARS)
  };
}

function bounded(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

function nonEmptyBounded(value: string, maxLength: number): string {
  return bounded(value.trim() || "unknown-extension", maxLength);
}

function catalogLabel(extension: Extension): string {
  const packageSource = extension.sourceInfo.origin === "package"
    ? extension.sourceInfo.source.trim()
    : "";
  const path = extension.path || extension.sourceInfo.path || extension.resolvedPath;
  const pathLabel = path.split(/[\\/]/u).pop() ?? path;
  return nonEmptyBounded(packageSource || pathLabel, MAX_EXTENSION_CATALOG_LABEL_CHARS);
}

function compareCatalogItems(left: ExtensionCatalogItem, right: ExtensionCatalogItem): number {
  if (left.loadState !== right.loadState) return left.loadState === "failed" ? -1 : 1;
  return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

function boundedCatalogItems(candidates: ExtensionCatalogItem[]): ExtensionCatalogItem[] {
  const encoder = new TextEncoder();
  const items: ExtensionCatalogItem[] = [];
  let bytes = 64;
  for (const candidate of candidates) {
    if (items.length >= MAX_EXTENSION_CATALOG_ITEMS) break;
    const candidateBytes = encoder.encode(JSON.stringify(candidate)).byteLength + 1;
    if (bytes + candidateBytes > MAX_EXTENSION_CATALOG_JSON_BYTES) continue;
    items.push(candidate);
    bytes += candidateBytes;
  }
  return items;
}

import type {
  ExtensionPackageEntry,
  ExtensionPackageUpdate,
  PackageResourceType,
  PackageSourceKind
} from "@pi67/domain";
import { nativeCapabilityReplacement } from "@pi67/domain";

export type PackageFilter = "all" | "enabled" | "disabled" | "updates";
export type ConfirmedAction =
  | { kind: "update"; entry: ExtensionPackageEntry }
  | { kind: "uninstall"; entry: ExtensionPackageEntry };

export interface PackageRow {
  kind: "configured";
  key: string;
  entry: ExtensionPackageEntry;
  inherited: boolean;
  update: ExtensionPackageUpdate | undefined;
}

export function buildPackageRows(
  items: ExtensionPackageEntry[],
  updates: ExtensionPackageUpdate[],
  scope: "global" | "project"
): PackageRow[] {
  return packagesForScope(items, scope)
    .filter(({ entry }) => !isBundledEntry(entry))
    .map(({ entry, inherited }): PackageRow => ({
      kind: "configured",
      key: `configured:${entry.source}`,
      entry,
      inherited,
      update: updates.find((candidate) => candidate.source === entry.source && candidate.scope === entry.scope)
    }));
}

export function filterPackageRows(rows: PackageRow[], filter: PackageFilter, query: string): PackageRow[] {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  return rows.filter((row) => {
    if (filter === "enabled" && !packageRowEnabled(row)) return false;
    if (filter === "disabled" && packageRowEnabled(row)) return false;
    if (filter === "updates" && !row.update) return false;
    if (!normalized) return true;
    const haystack = [
      packageRowName(row),
      row.entry.source,
      row.entry.version ?? "",
      row.entry.description ?? "",
      sourceKindLabel(resolveSourceKind(row.entry)),
      row.entry.scope
    ];
    return haystack.some((value) => value.toLocaleLowerCase("zh-CN").includes(normalized));
  });
}

export function packageResourceEnabled(
  entry: ExtensionPackageEntry,
  resourceType: PackageResourceType
): boolean {
  return entry.resourceStates?.find((state) => state.type === resourceType)?.enabled ?? entry.enabled;
}

export function packageResourceTypes(entry: ExtensionPackageEntry): PackageResourceType[] {
  return entry.resourceTypes?.length ? entry.resourceTypes : ["extension"];
}

export function packageRowEnabled(row: PackageRow): boolean {
  if (nativeCapabilityReplacement(row.entry.source)) return false;
  if (!row.entry.installed || !packageContentAdmitted(row.entry)) return false;
  return packageResourceTypes(row.entry).some((type) => packageResourceEnabled(row.entry, type));
}

export type PackageRowState =
  | "native-replaced"
  | "enabled"
  | "partial"
  | "disabled"
  | "not-installed"
  | "pending-confirmation"
  | "changed-pending-confirmation";

export function packageRowState(row: PackageRow): PackageRowState {
  if (nativeCapabilityReplacement(row.entry.source)) return "native-replaced";
  if (!row.entry.installed || row.entry.trustReason === "install-content-missing") return "not-installed";
  if (row.entry.trustState === "drifted") return "changed-pending-confirmation";
  if (!packageContentAdmitted(row.entry)) return "pending-confirmation";
  const states = packageResourceTypes(row.entry).map((type) => packageResourceEnabled(row.entry, type));
  if (states.every(Boolean)) return "enabled";
  if (states.some(Boolean)) return "partial";
  return "disabled";
}

export function packageRowName(row: PackageRow): string {
  if (row.entry.displayName) return row.entry.displayName;
  const source = row.entry.source;
  if (source.startsWith("npm:")) return source.slice(4);
  const normalized = source.replaceAll("\\", "/").replace(/\/+$/u, "");
  const last = normalized.split("/").at(-1) ?? source;
  return last.endsWith(".git") ? last.slice(0, -4) : last;
}

export function packageRowAccessibleName(row: PackageRow): string {
  const scope = row.inherited ? "继承自全局" : row.entry.scope === "global" ? "全局" : "当前项目";
  return `${packageRowName(row)}，${row.entry.source} · ${scope}`;
}

export function resolveSourceKind(entry: ExtensionPackageEntry): PackageSourceKind {
  return entry.sourceKind ?? inferSourceKind(entry.source);
}

export function inferSourceKind(source: string): PackageSourceKind {
  const normalized = source.trim().toLocaleLowerCase("en-US");
  if (normalized.startsWith("npm:")) return "npm";
  if (
    normalized.startsWith("git:")
    || normalized.startsWith("git+")
    || normalized.startsWith("git@")
    || normalized.endsWith(".git")
    || normalized.startsWith("http://")
    || normalized.startsWith("https://")
  ) return "git";
  if (
    normalized.startsWith("/")
    || normalized.startsWith("./")
    || normalized.startsWith("../")
    || /^[a-z]:[\\/]/iu.test(normalized)
  ) return "path";
  return "npm";
}

export function sourceKindLabel(kind: PackageSourceKind): string {
  if (kind === "bundled") return "随应用提供";
  if (kind === "npm") return "npm";
  if (kind === "git") return "Git";
  return "本地目录";
}

export function packageTrustLabel(entry: ExtensionPackageEntry): string {
  if (entry.trustState === "builtin-verified") return "应用内置并已验证";
  if (entry.trustState === "known-baseline-observed") return "已核对 Pi-67 已知内容基线";
  if (entry.trustState === "user-approved-observed") return "当前内容已由用户确认";
  if (entry.trustState === "user-installed-observed") return "Desktop 安装记录已核对";
  if (entry.trustState === "drifted") return "内容已变更，等待重新确认";
  if (entry.trustState === "unavailable") return "安装内容不可用";
  return entry.trustReason === "mutation-ambiguous" ? "安装结果等待确认" : "当前内容等待确认";
}

export function packageTrustReasonLabel(entry: ExtensionPackageEntry): string | undefined {
  const reason = entry.trustReason;
  if (reason === "receipt-missing") return "缺少 Desktop 持久化安装记录";
  if (reason === "install-content-missing") return "配置存在，但安装目录缺失";
  if (reason === "package-identity-changed") return "包名称、版本或已移除状态与记录不一致";
  if (reason === "manifest-changed") return "package.json 与安装记录不一致";
  if (reason === "directory-identity-changed") return "安装目录的物理身份已变化";
  if (reason === "content-hash-changed") return "包内容与安装记录不一致";
  if (reason === "receipt-invalid") return "安装记录或安装目录未通过完整性检查";
  if (reason === "inspection-limited") return "包内容超过安全检查预算";
  if (reason === "mutation-ambiguous") return "上一次安装操作无法证明最终结果";
  return undefined;
}

function packagesForScope(items: ExtensionPackageEntry[], scope: "global" | "project") {
  if (scope === "global") {
    return items.filter((entry) => entry.scope === "global").map((entry) => ({ entry, inherited: false }));
  }
  const projectSources = new Set(
    items.filter((entry) => entry.scope === "project").map((entry) => entry.source)
  );
  return [
    ...items.filter((entry) => entry.scope === "project").map((entry) => ({ entry, inherited: false })),
    ...items.filter((entry) => entry.scope === "global" && !projectSources.has(entry.source))
      .map((entry) => ({ entry, inherited: true }))
  ];
}

function isBundledEntry(entry: ExtensionPackageEntry): boolean {
  return entry.sourceKind === "bundled" || entry.origin === "first-party";
}

export function packageContentAdmitted(entry: ExtensionPackageEntry): boolean {
  return entry.trustState === "builtin-verified"
    || entry.trustState === "known-baseline-observed"
    || entry.trustState === "user-approved-observed"
    || entry.trustState === "user-installed-observed";
}

import type { DesktopBundledSkillSuiteSummary, SkillPackEntry } from "@pi67/domain";
import { Search } from "lucide-react";
import { useMemo } from "react";
import { Button } from "react-aria-components";
import {
  SettingsBackAction,
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import styles from "./SkillSettingsWorkspace.module.css";

export function BundledSkillSuiteDetail({ suite, pack, query, busy, onBack, onMutation, onQueryChange }: {
  suite: DesktopBundledSkillSuiteSummary;
  pack?: SkillPackEntry;
  query: string;
  busy: boolean;
  onBack: () => void;
  onMutation: (action: "update" | "restore", pack: SkillPackEntry) => void;
  onQueryChange: (query: string) => void;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const skills = useMemo(() => {
    const byId = new Map(suite.skills.map((skill) => [skill.id, skill]));
    const ids = pack?.skillIds ?? suite.skills.map((skill) => skill.id);
    return ids.map((id) => ({ id, skill: byId.get(id) })).filter(({ id, skill }) => (
      !normalizedQuery
      || [id, skill?.displayName, skill?.description, skill?.packageDisplayName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
    ));
  }, [normalizedQuery, pack?.skillIds, suite.skills]);
  const status = suiteStatus(suite, pack);
  return (
    <div className={styles.suiteDetail!} data-testid="bundled-skill-suite-detail">
      <SettingsBackAction label="返回全局可用技能" onPress={onBack}>返回全局可用</SettingsBackAction>
      <SettingsSectionBlock
        actions={<span className={styles.detailActions}>
          <span className={styles.detailStatus} data-status={status.id}>{status.label}</span>
          {pack?.updateStatus === "update-available" && pack.canUpdate ? (
            <Button className="primary-button" isDisabled={busy} onPress={() => onMutation("update", pack)}>
              更新套件
            </Button>
          ) : null}
          {pack?.canRestore ? (
            <Button className="secondary-button" isDisabled={busy} onPress={() => onMutation("restore", pack)}>
              恢复内置版本
            </Button>
          ) : null}
        </span>}
        title={suite.displayName}
        description={`${pack?.skillIds.length ?? suite.skills.length} 个技能 · ${suiteVersionSummary(suite, pack)}`}
      >
        <SettingsRows className={styles.suiteFacts!}>
          <SettingsRow
            title="内置基线"
            description={suiteVersionDescription(suite)}
            value={suiteVersionValue(suite)}
          />
          {pack?.manager === "lark-cli" ? <>
            <SettingsRow
              title="当前 CLI"
              description="本次检查固定使用的用户全局 lark-cli，不使用 Desktop 私有工具链中的副本。"
              value={pack.installedVersion ?? "待检查"}
            />
            <SettingsRow
              title="官方 Skills"
              description="由同一 lark-cli 返回的官方 Skills 同步版本。"
              value={pack.installedSkillVersion ?? "待检查"}
            />
            <SettingsRow
              title="最新稳定版本"
              description="来自最近一次 Lark CLI 更新检查。"
              value={pack.latestVersion ?? "待检查"}
            />
          </> : null}
          {pack?.manager === "pi67-desktop" ? <SettingsRow
            title="当前生效"
            description={pack.effectiveSource === "managed"
              ? "当前由 Pi-67 官方 registry 安装的独立 Overlay 提供，同名技能优先于内置 Package。"
              : "当前直接使用随 Desktop 发布且经过完整性校验的内置 Package。"}
            value={`${pack.installedVersion ?? pack.baselineVersion ?? "未知"} · ${pack.effectiveSource === "managed" ? "Overlay" : "内置"}`}
          /> : null}
          {pack?.latestVersion && pack.manager !== "lark-cli" ? <SettingsRow
            title={pi67RegistryVersionIsHistory(pack) ? "Registry 记录版本" : "最新兼容版本"}
            description={pi67RegistryVersionDescription(pack)}
            value={pack.latestVersion}
          /> : null}
          <SettingsRow
            title="更新方式"
            description={suiteUpdateDescription(suite)}
            value={suiteUpdateLabel(suite)}
          />
          {suite.upstream ? <SettingsRow
            title="上游来源"
            description={<span className={styles.upstreamUrl!}>{suite.upstream}</span>}
            value={suite.sourceCommit ? suite.sourceCommit.slice(0, 9) : "已登记"}
          /> : null}
        </SettingsRows>
        {pack?.detail ? <SettingsNotice
          tone={pack.updateStatus === "modified" || pack.updateStatus === "unavailable" ? "warning" : "info"}
        >{pack.detail}</SettingsNotice> : null}
        <label className={styles.skillSearch!}>
          <Search aria-hidden="true" size={15} />
          <input
            aria-label={`搜索 ${suite.displayName} 技能`}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="搜索技能名称、用途或来源"
            type="search"
            value={query}
          />
        </label>
        {skills.length > 0 ? <SettingsRows className={styles.skillRows!}>{skills.map(({ id, skill }) => (
          <SettingsRow
            key={skill ? `${skill.packageId}:${skill.id}` : id}
            title={skill?.displayName ?? id}
            description={skill ? skillPurpose(skill.description) : "由当前受管 Overlay 新增的 registry 成员。"}
            value={skill?.installed === false ? "准备中" : undefined}
          >
            <span className={styles.skillMeta}>{skill
              ? pack?.manager === "lark-cli"
                ? `Lark CLI 官方 Skills · ${pack.installedSkillVersion ?? "版本待检查"}`
                : `${skill.packageDisplayName} · ${pack?.installedVersion ?? skill.version}`
              : `Pi-67 registry Overlay · ${pack?.installedVersion ?? "当前版本"}`}</span>
          </SettingsRow>
        ))}</SettingsRows> : (
          <SettingsNotice className={styles.emptyResult!}>没有匹配的内置技能。</SettingsNotice>
        )}
        <SettingsNotice className={styles.scopeNotice!}>
          该内置套件对所有项目可用；当前任务最终使用哪个同名技能，以 Pi 的资源解析结果为准。
        </SettingsNotice>
      </SettingsSectionBlock>
    </div>
  );
}

export function suiteStatus(suite: DesktopBundledSkillSuiteSummary, pack?: SkillPackEntry): {
  id: "ready" | "partial" | "unavailable";
  label: string;
} {
  if (pack?.updateStatus === "update-available") return { id: "partial", label: pack.canUpdate ? "可更新" : "需手动更新" };
  if (pack?.updateStatus === "modified") {
    return { id: "unavailable", label: pack.manager === "lark-cli" ? "技能不同步" : "Overlay 异常" };
  }
  if (pack?.updateStatus === "unavailable") return { id: "unavailable", label: "检查失败" };
  if (pack?.updateStatus === "current") return { id: "ready", label: "已是最新" };
  if (pack?.updateStatus === "application-managed") {
    return { id: "ready", label: pack.manager === "pi67-desktop" ? "暂无可安装更新" : "随应用更新" };
  }
  if (pack?.updateStatus === "not-checked") return { id: "ready", label: "尚未检查" };
  if (pack?.manager === "pi67-desktop" && pack.effectiveSource === "managed") {
    return { id: "ready", label: "Overlay 生效" };
  }
  const installedCount = suite.skills.filter((skill) => skill.installed).length;
  if (installedCount === suite.skills.length) return { id: "ready", label: "全局可用" };
  if (installedCount > 0) return { id: "partial", label: "部分可用" };
  return { id: "unavailable", label: "准备中" };
}

export function suiteVersionSummary(suite: DesktopBundledSkillSuiteSummary, pack?: SkillPackEntry): string {
  if (pack?.manager === "lark-cli" && pack.installedVersion) return `当前 CLI ${pack.installedVersion}`;
  if (pack?.manager === "pi67-desktop") {
    const effectiveVersion = pack.installedVersion ?? pack.baselineVersion;
    if (effectiveVersion && pack.latestVersion) {
      const registryLabel = pi67RegistryVersionIsHistory(pack) ? "Registry 记录" : "最新兼容";
      return `当前 ${effectiveVersion} · ${registryLabel} ${pack.latestVersion}`;
    }
    if (pack.effectiveSource === "managed") return `当前 Overlay ${effectiveVersion ?? "未知"}`;
  }
  if (suite.bundledVersion) return `内置基线 ${suite.bundledVersion}`;
  if (suite.versionSource === "multiple-sources") return suiteSourceSummary(suite);
  return "基线未独立版本化";
}

function suiteSourceSummary(suite: DesktopBundledSkillSuiteSummary): string {
  const sources = new Set(suite.skills.map((skill) => `${skill.packageDisplayName} ${skill.version}`));
  return sources.size === 1 ? [...sources][0]! : `${sources.size} 个内置来源`;
}

function pi67RegistryVersionIsHistory(pack: SkillPackEntry): boolean {
  const effectiveVersion = pack.installedVersion ?? pack.baselineVersion;
  return pack.manager === "pi67-desktop"
    && Boolean(pack.latestVersion && effectiveVersion && pack.latestVersion !== effectiveVersion)
    && pack.updateStatus !== "update-available";
}

function pi67RegistryVersionDescription(pack: SkillPackEntry): string {
  const commit = pack.registryCommit ? `Pi-67 registry commit ${pack.registryCommit.slice(0, 9)}` : "最近一次 Pi-67 registry 检查";
  if (pi67RegistryVersionIsHistory(pack)) {
    return pack.updateStatus === "application-managed"
      ? `来自 ${commit}；该版本尚未开放独立安装，当前版本不会被覆盖。`
      : `来自 ${commit}；该记录不高于当前生效版本，仅作兼容历史，不会触发降级。`;
  }
  return `来自 ${commit}。`;
}

function suiteVersionValue(suite: DesktopBundledSkillSuiteSummary): string {
  if (suite.bundledVersion) return suite.bundledVersion;
  if (suite.versionSource === "multiple-sources") return suiteSourceSummary(suite);
  return "未独立版本化";
}

function suiteVersionDescription(suite: DesktopBundledSkillSuiteSummary): string {
  if (suite.versionSource === "skill-pack") {
    return "来自 Pi-67 Skill Pack registry 与锁文件，不使用承载它的 Pi-67 Core 版本冒充套件版本。";
  }
  if (suite.versionSource === "capability-package") {
    return "套件与其完整第一方能力包使用同一个已锁定版本。";
  }
  if (suite.versionSource === "multiple-sources") {
    return "这是多来源聚合分组，没有虚构的统一版本；每个技能保留真实承载来源和版本。";
  }
  return "当前上游内容尚未提供可验证的独立套件版本，因此只显示来源，不借用 Pi-67 Core 版本。";
}

function suiteUpdateLabel(suite: DesktopBundledSkillSuiteSummary): string {
  if (suite.updatePolicy === "capability-package") return "完整能力包";
  if (suite.updatePolicy === "source-specific") return "按来源管理";
  return suite.independentUpdateState === "available" ? "可独立管理" : "当前随 Desktop";
}

function suiteUpdateDescription(suite: DesktopBundledSkillSuiteSummary): string {
  if (suite.updateManager === "lark-cli") {
    return "内置基线随 Desktop 发布；同一“全局可用”页面中的受管套件由 Lark CLI 检查和更新。";
  }
  if (suite.updateManager === "pi67-skill-pack-registry") {
    return suite.independentUpdateState === "planned"
      ? "已登记上游与版本来源；受管兼容更新通道开放前仍随 Desktop 发布，不直接对上游仓库执行 git pull。"
      : "由 Pi-67 受管 Skill Pack registry 检查兼容版本、原子安装并支持回滚。";
  }
  if (suite.updateManager === "desktop-capability") {
    return "必须连同运行依赖、MCP、浏览器扩展和诊断合同一起更新，不能只替换其中几个技能。";
  }
  return "该分组包含多个第一方来源；版本和更新按每个来源分别处理。";
}

function skillPurpose(description: string): string {
  const normalized = description.replace(/\s+/gu, " ").trim();
  const chineseStop = normalized.indexOf("。");
  const englishStop = normalized.indexOf(". ");
  const stop = [
    chineseStop >= 0 ? chineseStop + 1 : Number.POSITIVE_INFINITY,
    englishStop >= 0 ? englishStop + 1 : Number.POSITIVE_INFINITY,
    180
  ].reduce((shortest, candidate) => Math.min(shortest, candidate));
  return normalized.length > stop ? `${normalized.slice(0, stop).trim()}…` : normalized;
}

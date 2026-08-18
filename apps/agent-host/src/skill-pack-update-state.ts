import type { SkillPackEntry } from "@pi67/domain";
import type { Pi67SkillPackRelease } from "./pi67-skill-pack-channel.js";
import { compareSkillPackVersions } from "./pi67-skill-pack-channel.js";
import { MAX_SKILL_PACK_PROCESS_OUTPUT_BYTES } from "./skill-pack-process-runner.js";
import {
  boundedNonNegativeInteger,
  boundedVersion,
  isRecord
} from "./skill-pack-validation.js";

export function parseLarkUpdateResult(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text, "utf8") > MAX_SKILL_PACK_PROCESS_OUTPUT_BYTES) {
    throw new Error("lark-cli returned an oversized update response.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("lark-cli returned invalid update JSON.");
  }
  if (!isRecord(value) || value.ok !== true) {
    throw new Error("lark-cli could not verify its update state.");
  }
  return value;
}

export function applyLarkUpdateCheck(
  entry: SkillPackEntry,
  value: Record<string, unknown>,
  options: { desktopManaged: boolean }
): SkillPackEntry {
  const installedVersion = boundedVersion(value.current_version ?? value.previous_version);
  const latestVersion = boundedVersion(value.latest_version);
  const skillsStatus = isRecord(value.skills_status) ? value.skills_status : undefined;
  const updateAvailable = value.action === "update_available"
    || Boolean(installedVersion && latestVersion && installedVersion !== latestVersion);
  const officialSkillCount = boundedNonNegativeInteger(skillsStatus?.official);
  const updatedSkillCount = boundedNonNegativeInteger(skillsStatus?.updated);
  const installedSkillVersion = boundedVersion(skillsStatus?.current);
  const targetSkillVersion = boundedVersion(skillsStatus?.target);
  const verifiedVersionSkew = updateAvailable
    && officialSkillCount !== undefined
    && officialSkillCount > 0
    && officialSkillCount === updatedSkillCount
    && installedSkillVersion === latestVersion
    && targetSkillVersion === installedVersion;
  const localState = skillsStatus?.in_sync === true || verifiedVersionSkew
    ? "clean" as const
    : skillsStatus?.in_sync === false
      ? "modified" as const
      : "unknown" as const;
  if (localState === "modified") {
    return {
      ...entry,
      ...(installedVersion ? { installedVersion } : {}),
      ...(installedSkillVersion ? { installedSkillVersion } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      updateStatus: "modified",
      localState,
      canUpdate: false,
      detail: "官方技能与受管版本不一致。为避免覆盖本地修改，Desktop 不会自动更新。"
    };
  }
  if (updateAvailable) {
    return {
      ...entry,
      ...(installedVersion ? { installedVersion } : {}),
      ...(installedSkillVersion ? { installedSkillVersion } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      updateStatus: "update-available",
      localState,
      canUpdate: true,
      detail: options.desktopManaged
        ? installedVersion && installedSkillVersion
          ? `当前 CLI ${installedVersion} 待更新；官方 Skills 已是 ${installedSkillVersion}。Desktop 将原子更新当前用户共享副本。`
          : "Desktop 将下载、验证并原子更新当前用户共享的 Lark CLI 与官方 Skills。"
        : "Desktop 将安装并优先使用经验证的当前用户共享副本；现有 Scoop、npm 或其他外部安装保持不变。"
    };
  }
  return {
    ...entry,
    ...(installedVersion ? { installedVersion } : {}),
    ...(installedSkillVersion ? { installedSkillVersion } : {}),
    ...(latestVersion ? { latestVersion } : {}),
    updateStatus: "current",
    localState,
    canUpdate: false,
    detail: localState === "clean"
      ? installedVersion && installedSkillVersion && installedVersion === installedSkillVersion
        ? `当前 CLI 与官方 Skills 均为 ${installedVersion}。`
        : "CLI 与官方技能均已同步。"
      : "当前没有可用更新。"
  };
}

export function applyPi67UpdateCheck(
  entry: SkillPackEntry,
  release: Pi67SkillPackRelease
): SkillPackEntry {
  const effectiveVersion = entry.installedVersion ?? entry.baselineVersion;
  if (!effectiveVersion) throw new Error("AI Berkshire baseline version is unavailable.");
  const comparison = compareSkillPackVersions(release.version, effectiveVersion);
  const provenance = {
    latestVersion: release.version,
    registryCommit: release.registryCommit
  };
  if (entry.localState === "modified") {
    return { ...entry, ...provenance, updateStatus: "modified", canUpdate: false };
  }
  if (comparison > 0 && release.independentlyInstallable) {
    return {
      ...entry,
      ...provenance,
      updateStatus: "update-available",
      canUpdate: true,
      detail: `Pi-67 官方 registry 已发布兼容版本 ${release.version}，确认后将安装为独立 Overlay。`
    };
  }
  if (comparison > 0) {
    return {
      ...entry,
      ...provenance,
      updateStatus: "application-managed",
      canUpdate: false,
      detail: `Pi-67 registry 已记录版本 ${release.version}，但尚未开放独立安装；当前继续使用 ${effectiveVersion}。`
    };
  }
  return {
    ...entry,
    ...provenance,
    updateStatus: "current",
    canUpdate: false,
    detail: entry.effectiveSource === "managed"
      ? "当前受管 Overlay 已是 Pi-67 registry 可用的最新版本。"
      : "当前内置基线不低于 Pi-67 registry 可用版本。"
  };
}

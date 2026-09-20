import type {
  ContextMemoryConfiguration,
  EnterpriseProjectSummary,
  EnterpriseTeamSummary
} from "@pi67/domain";
import { ChevronDown } from "lucide-react";
import {
  Button,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select
} from "react-aria-components";
import type { ContextMemoryOverview } from "../context-memory/context-memory-controller.js";
import styles from "./ContextMemorySettings.module.css";

export function EnterpriseProjectSelect({ projects, value, isDisabled, onChange }: {
  projects: EnterpriseProjectSummary[];
  value?: string;
  isDisabled: boolean;
  onChange: (value: string | undefined) => void;
}) {
  return <Select
    aria-label="New Money 项目"
    className={styles.projectSelect!}
    isDisabled={isDisabled}
    onSelectionChange={(key) => onChange(key === null ? undefined : String(key))}
    selectedKey={value ?? null}
  >
    <Label className={styles.projectSelectLabel}>New Money 项目</Label>
    <Button className={styles.projectSelectTrigger!}>
      <span>{projects.find((project) => project.id === value)?.name ?? "选择项目"}</span>
      <ChevronDown aria-hidden="true" size={13} />
    </Button>
    <Popover className={styles.projectSelectPopover!} placement="bottom end">
      <ListBox className={styles.projectSelectList!}>
        {projects.filter((project) => project.status === "active").map((project) => <ListBoxItem
          className={styles.projectSelectOption!}
          id={project.id}
          key={project.id}
          textValue={project.name}
        >
          <strong>{project.name}</strong>
          <small>当前团队 · {project.status === "active" ? "可用" : "已归档"}</small>
        </ListBoxItem>)}
      </ListBox>
    </Popover>
  </Select>;
}

export function EnterpriseTeamSelect({ teams, value, isDisabled, onChange }: {
  teams: EnterpriseTeamSummary[];
  value?: string;
  isDisabled: boolean;
  onChange: (value: string | undefined) => void;
}) {
  return <Select
    aria-label="New Money 团队"
    className={styles.projectSelect!}
    isDisabled={isDisabled}
    onSelectionChange={(key) => onChange(key === null ? undefined : String(key))}
    selectedKey={value ?? null}
  >
    <Label className={styles.projectSelectLabel}>团队</Label>
    <Button className={styles.projectSelectTrigger!}>
      <span>{teams.find((team) => team.id === value)?.name ?? "选择团队"}</span>
      <ChevronDown aria-hidden="true" size={13} />
    </Button>
    <Popover className={styles.projectSelectPopover!} placement="bottom end">
      <ListBox className={styles.projectSelectList!}>
        {teams.map((team) => <ListBoxItem
          className={styles.projectSelectOption!}
          id={team.id}
          key={team.id}
          textValue={team.name}
        >
          <strong>{team.name}</strong>
          <small>{enterpriseTeamDescription(team)}</small>
        </ListBoxItem>)}
      </ListBox>
    </Popover>
  </Select>;
}

export function configurationChanged(
  left: ContextMemoryConfiguration,
  right: ContextMemoryConfiguration
): boolean {
  return JSON.stringify({ ...left, revision: undefined })
    !== JSON.stringify({ ...right, revision: undefined });
}

export function healthLabel(value: ContextMemoryOverview["status"]["health"]): string {
  if (value === "healthy") return "正常";
  if (value === "degraded") return "降级";
  if (value === "conflict") return "冲突停用";
  if (value === "disabled") return "已关闭";
  return "不可用";
}

export function ownerLabel(value: ContextMemoryOverview["status"]["owner"]): string {
  if (value === "pi67-openviking") return "OpenViking";
  if (value === "pi-default-compaction") return "Pi 默认回退";
  return "无";
}

export function identityLabel(value: ContextMemoryOverview["identity"]["state"]): string {
  if (value === "signed-in") return "已登录";
  if (value === "pending") return "等待授权";
  if (value === "expired") return "已过期";
  return "本地模式";
}

export function bindingLabel(
  value: NonNullable<ContextMemoryOverview["binding"]>["state"] | undefined
): string {
  if (value === "bound") return "已绑定";
  if (value === "pending") return "待确认";
  if (value === "revoked") return "已撤销";
  return "未绑定";
}

export function enterpriseTeamDescription(team: EnterpriseTeamSummary): string {
  const members = team.quotasExempt === true
    ? `${team.memberCount} 人 · 不限额`
    : `${team.memberCount}/${team.maxMembers} 人`;
  const status = team.quotasExempt === true && team.entitlementStatus === "active"
    ? "内部自用"
    : entitlementLabel(team.entitlementStatus);
  return `${roleLabel(team.role)} · ${members} · ${status}`;
}

function roleLabel(value: EnterpriseTeamSummary["role"]): string {
  if (value === "owner") return "所有者";
  if (value === "admin") return "管理员";
  if (value === "viewer") return "只读成员";
  return "成员";
}

function entitlementLabel(value: EnterpriseTeamSummary["entitlementStatus"]): string {
  if (value === "trialing") return "试用中";
  if (value === "active") return "已启用";
  if (value === "past_due") return "待续费";
  if (value === "suspended") return "已暂停";
  return "已到期";
}

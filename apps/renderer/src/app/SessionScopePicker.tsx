import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useStore } from "zustand";
import type { ConversationScopeChoice, EnterpriseProjectSummary, EnterpriseTeamSummary } from "@pi67/domain";
import { loadEnterpriseProjects, loadEnterpriseTeams, loadEnterpriseWorkspaceBinding } from "../context-memory/context-memory-controller.js";
import { newMoneyAccountStore } from "../context-memory/new-money-account-store.js";
import { EnterpriseProjectSelect, EnterpriseTeamSelect } from "../settings/ContextMemorySettingsPresentation.js";
import { loadConversationScopeIdentity } from "../session/session-scope-identity.js";
import { saveWorkspaceConversationDefault, selectDraftConversationScope } from "../session/workspace-conversation-default-controller.js";
import { rendererWorkbenchStore, selectedWorkbenchTask, type RendererWorkbenchTask } from "../workbench/workbench-store.js";
import styles from "./SessionScopePicker.module.css";

export function SessionScopePicker({ task }: { task: RendererWorkbenchTask }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [teams, setTeams] = useState<EnterpriseTeamSummary[]>([]);
  const [projects, setProjects] = useState<EnterpriseProjectSummary[]>([]);
  const [teamId, setTeamId] = useState<string>();
  const [projectId, setProjectId] = useState<string>();
  const [kind, setKind] = useState<"private" | "team">(task.teamScope ? "team" : "private");
  const [owner, setOwner] = useState<{ userId: string; serviceEndpoint: string }>();
  const [loading, setLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [bindingCandidate, setBindingCandidate] = useState(false);
  const identity = useStore(newMoneyAccountStore, state => state.identity);
  const defaultChoice = useStore(rendererWorkbenchStore, state => state.conversationDefaults?.find(item => item.workspaceId === task.workspaceId)?.choice);
  const locked = saving || task.creationStatus !== undefined || task.environmentCreationState === "creating";
  const choice = task.scopeChoice;
  const label = task.teamScope ? choice?.kind === "team" ? `${choice.teamName} / ${choice.projectName}`
    : `${task.teamScope.teamId} / ${task.teamScope.projectId}` : "私人";
  const accountChanged = choice?.kind === "team" && identity !== undefined
    && (identity.state !== "signed-in" || identity.userId !== choice.userId);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true); setError(undefined); setOwner(undefined); setTeams([]); setProjects([]); setBindingCandidate(false);
    void (async () => {
      const account = await loadConversationScopeIdentity();
      if (!current) return;
      if (account.identity.state !== "signed-in" || !account.identity.userId) {
        setError("登录后可选择团队项目，也可以继续私人对话。"); return;
      }
      const availableTeams = await loadEnterpriseTeams();
      const preferred = task.scopeChoice?.kind === "team" ? task.scopeChoice : defaultChoice?.kind === "team" ? defaultChoice : undefined;
      const binding = !defaultChoice && account.identity.accountId
        ? await loadEnterpriseWorkspaceBinding(task.workspaceId, account.identity.accountId) : undefined;
      if (!current) return;
      const selectedTeam = availableTeams.find(team => team.id === preferred?.teamId)?.id
        ?? availableTeams.find(team => team.id === binding?.accountId)?.id
        ?? (availableTeams.length === 1 ? availableTeams[0]?.id : undefined);
      const selectedProject = preferred && preferred.teamId === selectedTeam ? preferred.projectId
        : binding?.state === "bound" && binding.accountId === selectedTeam ? binding.enterpriseProjectId : undefined;
      setOwner({ userId: account.identity.userId, serviceEndpoint: account.serviceEndpoint });
      setTeams(availableTeams); setTeamId(selectedTeam); setProjectId(selectedProject);
      setBindingCandidate(binding?.state === "bound" && selectedProject === binding.enterpriseProjectId);
    })().catch(() => { if (current) setError("无法读取团队或项目，请重试。原草稿保持不变。"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open, attempt, task.id, task.workspaceId, task.scopeChoice, defaultChoice, identity?.state, identity?.userId]);

  useEffect(() => {
    if (!open || !owner || !teamId) { setProjectsLoading(false); return; }
    let current = true;
    setProjectsLoading(true);
    void loadEnterpriseProjects(teamId).then(items => {
      if (!current) return;
      setProjects(items);
      setProjectId(previous => items.some(item => item.id === previous && item.status === "active") ? previous
        : items.filter(item => item.status === "active").length === 1 ? items.find(item => item.status === "active")?.id : undefined);
    }).catch(() => { if (current) setError("无法读取项目，请重试。"); })
      .finally(() => { if (current) setProjectsLoading(false); });
    return () => { current = false; };
  }, [teamId, owner, open]);

  const selectedTeam = teams.find(team => team.id === teamId);
  const selectedProject = projects.find(project => project.id === projectId && project.status === "active");
  const selection: ConversationScopeChoice | undefined = kind === "private" ? { kind: "private" }
    : owner && selectedTeam && selectedProject && !error ? { kind: "team", ...owner, teamId: selectedTeam.id,
      projectId: selectedProject.id, teamName: selectedTeam.name, projectName: selectedProject.name } : undefined;
  const apply = async (remember: boolean) => {
    const live = selectedWorkbenchTask(rendererWorkbenchStore.getState());
    if (!selection || locked || !live || live.id !== task.id || live.taskGeneration !== task.taskGeneration) return;
    setSaving(true); setError(undefined);
    try {
      if (remember) await saveWorkspaceConversationDefault(task.workspaceId, selection);
      const latest = selectedWorkbenchTask(rendererWorkbenchStore.getState());
      if (latest?.id !== task.id || latest.taskGeneration !== task.taskGeneration) return;
      if (!selectDraftConversationScope(task.id, selection)) throw new Error("当前草稿正在创建，请稍后重试。");
      setOpen(false);
    } catch { setError("未能应用对话归属，请重试。原草稿保持不变。"); }
    finally { setSaving(false); }
  };

  return <div className={styles.scope}>
    <button className={styles.trigger} type="button" disabled={locked} aria-expanded={open}
      aria-controls={`scope-${task.id}`} aria-label={`对话归属：${label}`} onClick={() => setOpen(!open)}>
      <span>{label}</span><ChevronDown aria-hidden="true" size={14} />
      <small>{!defaultChoice ? "设置工作区默认" : JSON.stringify(defaultChoice) === JSON.stringify(choice) ? "工作区默认" : "仅本次"}</small>
    </button>
    {accountChanged ? <small role="status">账户已变化，发送前请确认对话归属。</small> : null}
    {open ? <div className={styles.fields} id={`scope-${task.id}`}>
      <fieldset className={styles.kinds} disabled={locked}>
        <legend>对话归属</legend>
        <label><input type="radio" name={`scope-kind-${task.id}`} checked={kind === "private"} onChange={() => setKind("private")} />私人</label>
        <label><input type="radio" name={`scope-kind-${task.id}`} checked={kind === "team"} onChange={() => setKind("team")} />团队项目</label>
      </fieldset>
      {kind === "team" ? <>
        <EnterpriseTeamSelect teams={teams} {...(teamId ? { value: teamId } : {})} isDisabled={locked || loading || projectsLoading} onChange={value => {
          setProjects([]); setProjectId(undefined); setTeamId(value); setError(undefined); setBindingCandidate(false);
        }} />
        <EnterpriseProjectSelect projects={projects} {...(projectId ? { value: projectId } : {})} isDisabled={locked || loading || projectsLoading || !teamId} onChange={setProjectId} />
        {bindingCandidate ? <small>已预选此工作区绑定的项目。设为默认后，后续新对话会自动沿用。</small> : null}
        <p role="status">{loading || projectsLoading ? "正在读取可用项目…" : error ?? (!teams.length ? "暂无可用团队。" : teamId && !projects.some(project => project.status === "active") ? "此团队暂无可用项目。" : "发送前仍会检查当前权限。")}</p>
      </> : <small>私人对话不接入团队知识。</small>}
      <small>默认设置只影响后续新对话。有内容的草稿会保留并另开对话；团队对话不会自动写入私人长期记忆。</small>
      {error ? <><p role="alert">{error}</p><button type="button" disabled={locked || loading || projectsLoading} onClick={() => setAttempt(attempt + 1)}>重新读取</button></> : null}
      <div className={styles.actions}>
        <button type="button" disabled={locked || !selection || (kind === "team" && (loading || projectsLoading))} onClick={() => void apply(false)}>仅本次使用</button>
        <button type="button" disabled={locked || !selection || (kind === "team" && (loading || projectsLoading))} onClick={() => void apply(true)}>设为工作区默认</button>
        {defaultChoice ? <button type="button" disabled={locked} onClick={() => {
          if (selectDraftConversationScope(task.id, defaultChoice)) setOpen(false);
        }}>沿用工作区默认</button> : null}
      </div>
    </div> : null}
  </div>;
}

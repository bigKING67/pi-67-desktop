import { useEffect, useState } from "react";
import type { EnterpriseProjectSummary, EnterpriseTeamSummary } from "@pi67/domain";
import { loadEnterpriseProjects, loadEnterpriseTeams } from "../context-memory/context-memory-controller.js";
import { EnterpriseProjectSelect, EnterpriseTeamSelect } from "../settings/ContextMemorySettingsPresentation.js";
import { beginRendererSessionIntent } from "../session/session-creation-controller.js";
import { rendererWorkbenchStore, selectedWorkbenchTask, type RendererWorkbenchTask } from "../workbench/workbench-store.js";
import styles from "./SessionScopePicker.module.css";

export function SessionScopePicker({ task }: { task: RendererWorkbenchTask }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [teams, setTeams] = useState<EnterpriseTeamSummary[]>([]);
  const [projects, setProjects] = useState<EnterpriseProjectSummary[]>([]);
  const [teamId, setTeamId] = useState<string>();
  const [projectId, setProjectId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const locked = task.creationStatus !== undefined || task.environmentCreationState === "creating";

  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setError(undefined);
    setProjectId(undefined);
    setProjects([]);
    if (!teamId) setTeams([]);
    const load = teamId ? loadEnterpriseProjects(teamId) : loadEnterpriseTeams();
    void load.then((items) => {
      if (!current) return;
      if (teamId) setProjects(items as EnterpriseProjectSummary[]);
      else setTeams(items as EnterpriseTeamSummary[]);
    }).catch(() => {
      if (current) setError("无法读取团队或项目。请在设置中确认 New Money 登录与连接，然后重试。");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open, teamId, attempt]);

  const start = (team: boolean) => {
    const live = selectedWorkbenchTask(rendererWorkbenchStore.getState());
    if (!live || live.id !== task.id || live.taskGeneration !== task.taskGeneration
      || live.conversation.kind !== "provisional" || live.creationStatus !== undefined
      || live.environmentCreationState === "creating") return;
    if (team && (!teamId || !projects.some((project) => project.id === projectId && project.status === "active"))) return;
    const id = beginRendererSessionIntent(task.workspaceId, {
      ...(task.environmentIntent ? { environmentIntent: task.environmentIntent } : {}),
      ...(team && teamId && projectId ? { teamScope: { teamId, projectId } } : {})
    });
    if (!id) setError("当前正在创建或恢复会话，请稍后重试。原草稿保持不变。");
    else setOpen(false);
  };

  return <fieldset className={styles.scope}>
    <legend>会话范围</legend>
    <p>{task.teamScope ? `团队草稿 · ${task.teamScope.teamId} / ${task.teamScope.projectId}` : "私人草稿 · 不接入团队知识"}</p>
    <small>更换范围会另开草稿，原内容保留。团队会话不会自动写入私人长期记忆。</small>
    <div className={styles.actions}>
      {task.teamScope ? <button type="button" disabled={locked} onClick={() => start(false)}>另开私人草稿</button> : null}
      <button type="button" disabled={locked} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "收起团队选择" : "选择团队与项目"}
      </button>
    </div>
    {open ? <div className={styles.fields}>
      <EnterpriseTeamSelect teams={teams} {...(teamId ? { value: teamId } : {})} isDisabled={locked || loading} onChange={(value) => {
        setProjectId(undefined); setProjects([]); setTeamId(value);
      }} />
      <EnterpriseProjectSelect projects={projects} {...(projectId ? { value: projectId } : {})} isDisabled={locked || loading || !teamId} onChange={setProjectId} />
      <p role="status">{loading ? "正在读取可用范围…" : error ?? (!teamId && teams.length === 0
        ? "暂无可选团队。请先在设置中登录 New Money，或在管理网页创建／加入团队。"
        : teamId && !projects.some((project) => project.status === "active") ? "此团队暂无可用项目。" : "选择仅记录创建意图；发送前仍会检查权限。")}</p>
      {error ? <button type="button" disabled={loading || locked} onClick={() => setAttempt(attempt + 1)}>重新读取</button> : null}
      <button type="button" disabled={locked || loading || !!error || !teamId || !projectId} onClick={() => start(true)}>另开团队草稿</button>
    </div> : null}
  </fieldset>;
}

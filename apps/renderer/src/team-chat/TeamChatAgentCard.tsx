import { useEffect, useMemo, useState } from "react";
import { Button } from "react-aria-components";
import {
  TEAM_CHAT_AGENT_LIMITS,
  type EnterpriseProjectSummary,
  type TeamChatAgent,
  type TeamChatAgentActivity,
  type TeamChatAgentBinding,
  type TeamChatDirectory
} from "@pi67/domain";
import type { PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { loadNewSessionRuntimeConfiguration } from "../composer/new-session-runtime-controller.js";
import { messages } from "../localization/message-catalog.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { teamChat } from "./team-chat-instance.js";
import { formatTeamChatTime } from "./team-chat-presentation.js";
import { agentPresenceLabel, TeamChatAgentAvatar } from "./TeamChatParts.js";
import styles from "./TeamChat.module.css";
import agentStyles from "./TeamChatAgents.module.css";

const MODEL_SEPARATOR = "\u0000";

interface ModelOption { value: string; label: string }

/** Configured models for a Workspace, as the new-Session picker sees them. */
function useModelOptions(workspaceId: string): ModelOption[] | "loading" | "error" {
  const [options, setOptions] = useState<ModelOption[] | "loading" | "error">("loading");
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setOptions("loading");
    loadNewSessionRuntimeConfiguration(workspaceId).then(
      (snapshot) => { if (active) setOptions(modelOptions(snapshot)); },
      () => { if (active) setOptions("error"); }
    );
    return () => { active = false; };
  }, [workspaceId]);
  return options;
}

function modelOptions(snapshot: PiProviderConfigurationSnapshot): ModelOption[] {
  return snapshot.providers.filter((provider) => provider.configured).flatMap((provider) => provider.models.map((model) => ({
    value: `${provider.id}${MODEL_SEPARATOR}${model.id}`,
    label: `${provider.name ?? provider.id} · ${model.name ?? model.id}`
  })));
}

export function TeamChatAgentCard({ agent, binding, activity, directory, projects }: {
  agent: TeamChatAgent;
  binding: TeamChatAgentBinding | undefined;
  activity: readonly TeamChatAgentActivity[];
  directory: TeamChatDirectory;
  projects: EnterpriseProjectSummary[] | "error" | undefined;
}) {
  const copy = messages.teamChat;
  const workspaceOrder = useWorkbenchStore((state) => state.workspaceOrder);
  const workspaceRecords = useWorkbenchStore((state) => state.workspaces);
  const workspaces = useMemo(() => workspaceOrder.map((id) => workspaceRecords[id])
    .filter((workspace) => workspace?.availability === "available"), [workspaceOrder, workspaceRecords]);
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [dailyLimit, setDailyLimit] = useState(String(agent.dailyLimit));
  const [workspaceId, setWorkspaceId] = useState(binding?.workspaceId ?? workspaces[0]?.id ?? "");
  const [projectId, setProjectId] = useState(binding?.projectId ?? "");
  const [model, setModel] = useState(binding ? `${binding.model.provider}${MODEL_SEPARATOR}${binding.model.id}` : "");
  const [enabled, setEnabled] = useState(binding?.enabled ?? true);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const models = useModelOptions(workspaceId);
  const selfRole = directory.members.find((member) => member.userId === directory.selfUserId)?.role;
  const admin = selfRole === "owner" || selfRole === "admin";

  useEffect(() => {
    if (!projectId && Array.isArray(projects) && projects.length === 1) setProjectId(projects[0]!.id);
  }, [projectId, projects]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try { await action(); } catch (caught) { setError(teamChatErrorMessage(caught)); } finally { setBusy(false); }
  };
  const limit = Number(dailyLimit);
  const edited = name.trim() !== agent.name || description.trim() !== agent.description || limit !== agent.dailyLimit;
  const editValid = name.trim().length > 0 && Number.isInteger(limit) && limit >= 1 && limit <= TEAM_CHAT_AGENT_LIMITS.dailyLimit;
  const [provider, modelId] = model.split(MODEL_SEPARATOR);
  const hostValid = Boolean(workspaceId && projectId && provider && modelId);

  return (
    <article aria-label={agent.name} className={agentStyles.card}>
      <header className={agentStyles.cardHeader}>
        <TeamChatAgentAvatar agent={agent} />
        <strong>{agent.name}</strong>
        <small className={agentStyles.rowMeta}>{agentPresenceLabel(agent)}</small>
        <span className={agentStyles.spacer} />
        {agent.status === "active" ? (
          <Button className="small-button" isDisabled={busy} onPress={() => void run(() => teamChat.setAgentDisabled(agent.userId, true))}>{copy.agentDisable}</Button>
        ) : (
          <Button className="small-button" isDisabled={busy || (agent.disabledByAdmin && !admin)}
            onPress={() => void run(() => teamChat.setAgentDisabled(agent.userId, false))}>{copy.agentEnable}</Button>
        )}
        <Button className={`small-button ${confirmRemove ? agentStyles.armedDanger ?? "" : ""}`} isDisabled={busy}
          onPress={() => confirmRemove ? void run(() => teamChat.removeAgent(agent.userId)) : setConfirmRemove(true)}>
          {confirmRemove ? copy.agentConfirmRemove : copy.agentRemove}
        </Button>
      </header>
      {agent.disabledByAdmin ? <p className={agentStyles.disclosure}>{copy.agentDisabledByAdmin}</p> : null}
      <form className={agentStyles.fieldGrid} onSubmit={(event) => {
        event.preventDefault();
        if (edited && editValid) {
          void run(() => teamChat.updateAgent({ agentUserId: agent.userId, name: name.trim(), description: description.trim(), dailyLimit: limit }));
        }
      }}>
        <label className={styles.field}>
          <span>{copy.agentName}</span>
          <input maxLength={TEAM_CHAT_AGENT_LIMITS.name * 2} onChange={(event) => setName(event.currentTarget.value)} value={name} />
        </label>
        <label className={styles.field}>
          <span>{copy.agentDailyLimit}</span>
          <input max={TEAM_CHAT_AGENT_LIMITS.dailyLimit} min={1} onChange={(event) => setDailyLimit(event.currentTarget.value)} type="number" value={dailyLimit} />
        </label>
        <label className={`${styles.field} ${agentStyles.wide}`}>
          <span>{copy.agentDescription}</span>
          <input maxLength={TEAM_CHAT_AGENT_LIMITS.description} onChange={(event) => setDescription(event.currentTarget.value)} value={description} />
        </label>
        <div className={`${agentStyles.actions} ${agentStyles.wide}`}>
          <Button className="secondary-button" isDisabled={busy || !edited || !editValid} type="submit">{copy.agentSave}</Button>
        </div>
      </form>
      <section aria-label={copy.agentHostTitle} className={agentStyles.hostSection}>
        <h3>{copy.agentHostTitle}</h3>
        <p className={agentStyles.disclosure}>{binding?.enabled ? copy.agentHostActive : copy.agentHostNone}</p>
        {projects === "error" || models === "error" ? <p className={styles.formError} role="alert">{copy.agentHostFailed}</p> : null}
        <div className={agentStyles.fieldGrid}>
          <label className={`${styles.field} ${agentStyles.wide}`}>
            <span>{copy.agentHostWorkspace}</span>
            <select onChange={(event) => setWorkspaceId(event.currentTarget.value)} value={workspaceId}>
              {workspaces.map((workspace) => <option key={workspace!.id} value={workspace!.id}>{workspace!.displayName}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>{copy.agentHostProject}</span>
            <select onChange={(event) => setProjectId(event.currentTarget.value)} value={projectId}>
              <option value="">{projects === undefined ? copy.agentHostLoading : copy.startWorkProject}</option>
              {Array.isArray(projects) ? projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>) : null}
            </select>
          </label>
          <label className={styles.field}>
            <span>{copy.agentHostModel}</span>
            <select onChange={(event) => setModel(event.currentTarget.value)} value={model}>
              <option value="">{models === "loading" ? copy.agentHostLoading : copy.agentHostModel}</option>
              {Array.isArray(models) ? models.map((option) => <option key={option.value} value={option.value}>{option.label}</option>) : null}
            </select>
            <small>{copy.agentHostModelHint}</small>
          </label>
          <label className={`${agentStyles.toggle} ${agentStyles.wide}`}>
            <input checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} type="checkbox" />
            {copy.agentHostEnabled}
          </label>
        </div>
        <div className={agentStyles.actions}>
          <Button className="primary-button" isDisabled={busy || !hostValid}
            onPress={() => void run(() => teamChat.hostAgent({ agentUserId: agent.userId, workspaceId, projectId,
              model: { provider: provider!, id: modelId! }, enabled }))}>{copy.agentHostSave}</Button>
          {binding ? (
            <Button className="secondary-button" isDisabled={busy} onPress={() => void run(() => teamChat.stopHostingAgent(agent.userId))}>
              {copy.agentHostStop}
            </Button>
          ) : null}
        </div>
        {activity.length > 0 ? (
          <ul aria-label={copy.agentActivity} className={agentStyles.activity}>
            {activity.slice(0, 3).map((item) => (
              <li key={item.invocationId}>
                {`${formatTeamChatTime(item.at)} · ${copy.agentActivityState[item.state] ?? item.state}`}
                {item.reason ? ` · ${copy.invocationReasons[item.reason] ?? item.reason}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
    </article>
  );
}

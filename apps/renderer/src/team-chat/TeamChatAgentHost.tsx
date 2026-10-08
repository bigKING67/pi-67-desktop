import { useEffect, useMemo, useState } from "react";
import type { EnterpriseProjectSummary, TeamChatAgentBinding } from "@pi67/domain";
import type { PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { loadNewSessionRuntimeConfiguration } from "../composer/new-session-runtime-controller.js";
import { loadEnterpriseProjects } from "../context-memory/context-memory-controller.js";
import { messages } from "../localization/message-catalog.js";
import { ProviderBrandIcon } from "../provider-brand/ProviderBrandIcon.js";
import { SettingsInfo, SettingsSelect, type SettingsSelectOption } from "../settings/SettingsPrimitives.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import styles from "./TeamChat.module.css";
import agentStyles from "./TeamChatAgents.module.css";

const MODEL_SEPARATOR = "\u0000";

/** How this Desktop runs one Agent, as edited before it becomes a binding. */
export interface AgentHostDraft {
  workspaceId: string;
  projectId: string;
  model: string;
}

type Loaded<T> = T | "loading" | "error";

/** Active team projects, loaded once per dialog. */
export function useTeamProjects(teamId: string | undefined): Loaded<EnterpriseProjectSummary[]> {
  const [projects, setProjects] = useState<Loaded<EnterpriseProjectSummary[]>>("loading");
  useEffect(() => {
    if (!teamId) return;
    let active = true;
    loadEnterpriseProjects(teamId).then(
      (items) => { if (active) setProjects(items.filter((project) => project.status === "active")); },
      () => { if (active) setProjects("error"); }
    );
    return () => { active = false; };
  }, [teamId]);
  return projects;
}

/** Workspaces this Desktop can run an Agent in. */
export function useHostWorkspaces() {
  const workspaceOrder = useWorkbenchStore((state) => state.workspaceOrder);
  const workspaceRecords = useWorkbenchStore((state) => state.workspaces);
  return useMemo(() => workspaceOrder.map((id) => workspaceRecords[id])
    .filter((workspace) => workspace?.availability === "available")
    .map((workspace) => ({ id: workspace!.id, label: workspace!.displayName })), [workspaceOrder, workspaceRecords]);
}

/** Configured models for a Workspace, as the new-Session picker sees them. */
function useModelOptions(workspaceId: string): Loaded<SettingsSelectOption<string>[]> {
  const [options, setOptions] = useState<Loaded<SettingsSelectOption<string>[]>>("loading");
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

/** Same model choice anatomy as the Settings model selects: brand mark, model first, Provider as section and detail. */
function modelOptions(snapshot: PiProviderConfigurationSnapshot): SettingsSelectOption<string>[] {
  return snapshot.providers.filter((provider) => provider.configured).flatMap((provider) => provider.models.map((model) => ({
    id: `${provider.id}${MODEL_SEPARATOR}${model.id}`,
    label: model.name ?? model.id,
    detail: provider.name ?? provider.id,
    section: provider.name ?? provider.id,
    leading: <ProviderBrandIcon hints={[model.id, model.name, provider.id, provider.name]} label={model.name ?? model.id} size="inline" />
  })));
}

export function hostDraftFrom(binding: TeamChatAgentBinding | undefined, workspaces: readonly { id: string }[]): AgentHostDraft {
  return binding
    ? { workspaceId: binding.workspaceId, projectId: binding.projectId, model: `${binding.model.provider}${MODEL_SEPARATOR}${binding.model.id}` }
    : { workspaceId: workspaces[0]?.id ?? "", projectId: "", model: "" };
}

/** The binding a complete draft describes, or undefined while a choice is missing. */
export function bindingFrom(agentUserId: string, draft: AgentHostDraft): TeamChatAgentBinding | undefined {
  const [provider, id] = draft.model.split(MODEL_SEPARATOR);
  if (!draft.workspaceId || !draft.projectId || !provider || !id) return undefined;
  return { agentUserId, workspaceId: draft.workspaceId, projectId: draft.projectId, model: { provider, id }, enabled: true };
}

export function sameHostDraft(left: AgentHostDraft, right: AgentHostDraft): boolean {
  return left.workspaceId === right.workspaceId && left.projectId === right.projectId && left.model === right.model;
}

/**
 * Workspace, team project and model for running an Agent on this Desktop. Reports whether
 * choices could load, so a dialog can still create the Agent and leave running for later.
 */
export function AgentHostFields({ draft, onChange, projects, workspaces, onAvailability }: {
  draft: AgentHostDraft;
  onChange: (draft: AgentHostDraft) => void;
  projects: Loaded<EnterpriseProjectSummary[]>;
  workspaces: readonly { id: string; label: string }[];
  onAvailability?: (available: boolean) => void;
}) {
  const copy = messages.teamChat;
  const models = useModelOptions(draft.workspaceId);
  const failed = projects === "error" || models === "error";
  const available = !failed && workspaces.length > 0
    && (!Array.isArray(projects) || projects.length > 0) && (!Array.isArray(models) || models.length > 0);

  useEffect(() => {
    if (!draft.projectId && Array.isArray(projects) && projects.length === 1) onChange({ ...draft, projectId: projects[0]!.id });
  }, [draft, onChange, projects]);
  useEffect(() => { onAvailability?.(available); }, [available, onAvailability]);

  return (
    <div className={agentStyles.fieldGrid}>
      {failed ? <p className={`${styles.formError} ${agentStyles.wide}`} role="alert">{copy.agentHostFailed}</p> : null}
      {!failed && !available ? <p className={`${agentStyles.disclosure} ${agentStyles.wide}`}>{copy.agentHostUnavailable}</p> : null}
      <div className={`${styles.field} ${agentStyles.wide}`}>
        <span className={agentStyles.fieldLabel}>
          {copy.agentHostWorkspace}
          <SettingsInfo label={copy.agentHostWorkspaceInfoLabel}>{copy.agentHostWorkspaceInfo}</SettingsInfo>
        </span>
        <SettingsSelect className={styles.fieldSelect!} label={copy.agentHostWorkspace} value={draft.workspaceId}
          onChange={(workspaceId) => onChange({ ...draft, workspaceId, model: "" })}
          options={workspaces} />
      </div>
      <div className={styles.field}>
        <span>{copy.agentHostProject}</span>
        <SettingsSelect className={styles.fieldSelect!} label={copy.agentHostProject} value={draft.projectId}
          onChange={(projectId) => onChange({ ...draft, projectId })}
          options={[{ id: "", label: projects === "loading" ? copy.agentHostLoading : copy.startWorkProject, disabled: true },
            ...(Array.isArray(projects) ? projects.map((project) => ({ id: project.id, label: project.name })) : [])]} />
      </div>
      <div className={styles.field}>
        <span>{copy.agentHostModel}</span>
        <SettingsSelect className={styles.fieldSelect!} label={copy.agentHostModel} value={draft.model}
          onChange={(model) => onChange({ ...draft, model })}
          options={[{ id: "", label: models === "loading" ? copy.agentHostLoading : copy.agentHostChooseModel, disabled: true },
            ...(Array.isArray(models) ? models : [])]} />
        <small>{copy.agentHostModelHint}</small>
      </div>
    </div>
  );
}

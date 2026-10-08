import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { TEAM_CHAT_AGENT_LIMITS, type TeamChatAgent } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { SettingsSwitch } from "../settings/SettingsPrimitives.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import { formatTeamChatTime } from "./team-chat-presentation.js";
import {
  AgentHostFields, bindingFrom, hostDraftFrom, sameHostDraft, useHostWorkspaces, useTeamProjects, type AgentHostDraft
} from "./TeamChatAgentHost.js";
import { agentPresenceLabel, TeamChatAgentAvatar } from "./TeamChatParts.js";
import styles from "./TeamChat.module.css";
import agentStyles from "./TeamChatAgents.module.css";

/**
 * Settings for one of the user's own Agents, opened from its direct message like
 * `频道设置`. Profile and running on this Desktop are one draft with one save that
 * appears only while something changed; disabling and deleting act immediately.
 */
export function TeamChatAgentSettingsDialog({ agent, onClose }: { agent: TeamChatAgent; onClose: () => void }) {
  const copy = messages.teamChat;
  const directory = useTeamChat((state) => state.directory);
  const hostState = useTeamChat((state) => state.agentHost);
  const binding = hostState?.bindings.find((item) => item.agentUserId === agent.userId);
  const activity = hostState?.activity.filter((item) => item.agentUserId === agent.userId) ?? [];
  const workspaces = useHostWorkspaces();
  const projects = useTeamProjects(directory?.teamId);
  const running = binding?.enabled === true;

  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [dailyLimit, setDailyLimit] = useState(String(agent.dailyLimit));
  const [runHere, setRunHere] = useState(running);
  const [host, setHost] = useState<AgentHostDraft>(() => hostDraftFrom(binding, workspaces));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => { void teamChat.loadAgentHost().catch(() => undefined); }, []);
  // The host state arrives after the dialog opens; adopt it until the user edits running.
  const [hostTouched, setHostTouched] = useState(false);
  useEffect(() => {
    if (hostTouched) return;
    setRunHere(running);
    setHost(hostDraftFrom(binding, workspaces));
  }, [binding, hostTouched, running, workspaces]);

  const limit = Number(dailyLimit);
  const profileDirty = name.trim() !== agent.name || description.trim() !== agent.description || limit !== agent.dailyLimit;
  const profileValid = name.trim().length > 0 && Number.isInteger(limit) && limit >= 1 && limit <= TEAM_CHAT_AGENT_LIMITS.dailyLimit;
  const nextBinding = bindingFrom(agent.userId, host);
  const hostDirty = runHere !== running || (runHere && !sameHostDraft(host, hostDraftFrom(binding, workspaces)));
  const dirty = profileDirty || hostDirty;
  const canSave = !busy && dirty && profileValid && (!runHere || nextBinding !== undefined);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try { await action(); } catch (caught) { setError(teamChatErrorMessage(caught)); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    if (profileDirty) {
      await teamChat.updateAgent({ agentUserId: agent.userId, name: name.trim(), description: description.trim(), dailyLimit: limit });
    }
    if (hostDirty) {
      if (runHere && nextBinding) await teamChat.hostAgent(nextBinding);
      else if (!runHere && binding) await teamChat.stopHostingAgent(agent.userId);
    }
    setHostTouched(false);
  });
  const editHost = (next: AgentHostDraft) => { setHostTouched(true); setHost(next); };

  return (
    <ModalOverlay className="modal-overlay" isDismissable={!busy} isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Modal className={`modal-surface ${agentStyles.agentModal}`}>
        <Dialog aria-label={copy.agentSettings} className={styles.channelDialog!}>
          <Heading slot="title">{copy.agentSettings}</Heading>
          <div className={agentStyles.cardHeader}>
            <TeamChatAgentAvatar agent={agent} />
            <strong>{agent.name}</strong>
            <small className={agentStyles.rowMeta}>{agentPresenceLabel(agent)}</small>
          </div>
          {agent.disabledByAdmin ? <p className={agentStyles.disclosure}>{copy.agentDisabledByAdmin}</p> : null}
          <form className={styles.channelForm} onSubmit={(event) => { event.preventDefault(); if (canSave) void save(); }}>
            <div className={agentStyles.fieldGrid}>
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
            </div>
            <section aria-label={copy.agentHostTitle} className={agentStyles.hostSection}>
              <div className={agentStyles.hostHeading}>
                <h3>{copy.agentHostTitle}</h3>
                <SettingsSwitch isDisabled={busy} isSelected={runHere} label={copy.agentHostTitle}
                  onChange={(selected) => { setHostTouched(true); setRunHere(selected); }} />
              </div>
              {runHere
                ? <AgentHostFields draft={host} onChange={editHost} projects={projects} workspaces={workspaces} />
                : <p className={agentStyles.disclosure}>{copy.agentHostNone}</p>}
            </section>
            {activity.length > 0 ? (
              <section aria-label={copy.agentActivity} className={agentStyles.hostSection}>
                <h3>{copy.agentActivity}</h3>
                <ul className={agentStyles.activity}>
                  {activity.slice(0, 3).map((item) => (
                    <li key={item.invocationId}>
                      {`${formatTeamChatTime(item.at)} · ${copy.agentActivityState[item.state] ?? item.state}`}
                      {item.reason ? ` · ${copy.invocationReasons[item.reason] ?? item.reason}` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {error ? <p className={styles.formError} role="alert">{error}</p> : null}
            <div className={agentStyles.settingsActions}>
              <div className={agentStyles.actions}>
                {agent.status === "active" ? (
                  <Button className="small-button" isDisabled={busy} onPress={() => void run(() => teamChat.setAgentDisabled(agent.userId, true))}>{copy.agentDisable}</Button>
                ) : (
                  <Button className="small-button" isDisabled={busy || agent.disabledByAdmin}
                    onPress={() => void run(() => teamChat.setAgentDisabled(agent.userId, false))}>{copy.agentEnable}</Button>
                )}
                <Button className={`small-button ${confirmRemove ? agentStyles.armedDanger ?? "" : ""}`} isDisabled={busy}
                  onPress={() => confirmRemove
                    ? void run(async () => { await teamChat.removeAgent(agent.userId); onClose(); })
                    : setConfirmRemove(true)}>
                  {confirmRemove ? copy.agentConfirmRemove : copy.agentRemove}
                </Button>
              </div>
              <div className={styles.dialogActions}>
                <Button className="secondary-button" isDisabled={busy} onPress={onClose}>{copy.close}</Button>
                {dirty ? <Button className="primary-button" isDisabled={!canSave} type="submit">{copy.agentSave}</Button> : null}
              </div>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

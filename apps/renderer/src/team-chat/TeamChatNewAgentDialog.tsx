import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { TEAM_CHAT_AGENT_LIMITS } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import { AgentHostFields, bindingFrom, hostDraftFrom, useHostWorkspaces, useTeamProjects, type AgentHostDraft } from "./TeamChatAgentHost.js";
import styles from "./TeamChat.module.css";
import agentStyles from "./TeamChatAgents.module.css";

/**
 * Creates an Agent and, in the same step, runs it on this Desktop, then opens its
 * direct message, where `Agent 设置` lives. When running cannot be configured yet
 * (no project, no model), it still creates the Agent and leaves running for later.
 */
export function TeamChatNewAgentDialog({ onClose }: { onClose: () => void }) {
  const copy = messages.teamChat;
  const directory = useTeamChat((state) => state.directory);
  const workspaces = useHostWorkspaces();
  const projects = useTeamProjects(directory?.teamId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [host, setHost] = useState<AgentHostDraft>(() => hostDraftFrom(undefined, workspaces));
  const [hostAvailable, setHostAvailable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => { void teamChat.loadAgentHost().catch(() => undefined); }, []);

  const trimmed = name.trim();
  const runnable = hostAvailable && bindingFrom("pending", host) !== undefined;
  const canSubmit = trimmed.length > 0 && !saving && (runnable || !hostAvailable);

  const create = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(undefined);
    let agentUserId: string;
    try {
      agentUserId = await teamChat.createAgent({ name: trimmed, description: description.trim() });
    } catch (caught) {
      setError(teamChatErrorMessage(caught));
      setSaving(false);
      return;
    }
    const binding = runnable ? bindingFrom(agentUserId, host) : undefined;
    if (binding) {
      // The Agent exists now; a hosting failure is reported, and Agent 设置 can retry it.
      await teamChat.hostAgent(binding).catch((caught: unknown) => publishNotification({
        level: "warning", title: copy.agentCreatedNotRunning, message: teamChatErrorMessage(caught)
      }));
    }
    onClose();
    void teamChat.openDirectMessage(agentUserId).catch(() => undefined);
  };

  return (
    <ModalOverlay className="modal-overlay" isDismissable={!saving} isOpen onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <Modal className={`modal-surface ${agentStyles.agentModal}`}>
        <Dialog aria-label={copy.agentCreateTitle} className={styles.channelDialog!}>
          <Heading slot="title">{copy.agentCreateTitle}</Heading>
          {/* Capability and cost boundary: shown before anything is created, never only in a tip. */}
          <p className={agentStyles.disclosure}>{copy.agentsIntro}</p>
          <form className={styles.channelForm} onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <div className={agentStyles.fieldGrid}>
              <label className={styles.field}>
                <span>{copy.agentName}</span>
                <input autoFocus maxLength={TEAM_CHAT_AGENT_LIMITS.name * 2} onChange={(event) => setName(event.currentTarget.value)} required value={name} />
              </label>
              <label className={styles.field}>
                <span>{copy.agentDescription}</span>
                <input maxLength={TEAM_CHAT_AGENT_LIMITS.description} onChange={(event) => setDescription(event.currentTarget.value)} value={description} />
              </label>
            </div>
            <section aria-label={copy.agentHostTitle} className={agentStyles.hostSection}>
              <h3>{copy.agentHostTitle}</h3>
              <AgentHostFields draft={host} onAvailability={setHostAvailable} onChange={setHost} projects={projects} workspaces={workspaces} />
            </section>
            {error ? <p className={styles.formError} role="alert">{error}</p> : null}
            <div className={styles.dialogActions}>
              <Button className="secondary-button" isDisabled={saving} onPress={onClose}>{copy.cancel}</Button>
              <Button className="primary-button" isDisabled={!canSubmit} type="submit">
                {saving ? copy.agentCreating : hostAvailable ? copy.agentCreateAndRun : copy.agentCreate}
              </Button>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

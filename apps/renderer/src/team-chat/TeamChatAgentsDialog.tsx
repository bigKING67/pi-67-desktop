import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { TEAM_CHAT_AGENT_LIMITS, teamChatCanCreateAgent, type EnterpriseProjectSummary } from "@pi67/domain";
import { loadEnterpriseProjects } from "../context-memory/context-memory-controller.js";
import { messages } from "../localization/message-catalog.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import { TeamChatAgentCard } from "./TeamChatAgentCard.js";
import styles from "./TeamChat.module.css";
import agentStyles from "./TeamChatAgents.module.css";

/** The user's own Agents: create, edit, enable, remove, and run them on this Desktop. */
export function TeamChatAgentsDialog({ onClose }: { onClose: () => void }) {
  const copy = messages.teamChat;
  const directory = useTeamChat((state) => state.directory);
  const host = useTeamChat((state) => state.agentHost);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [projects, setProjects] = useState<EnterpriseProjectSummary[] | "error">();
  const teamId = directory?.teamId;

  useEffect(() => { void teamChat.loadAgentHost().catch(() => undefined); }, []);
  useEffect(() => {
    if (!teamId) return;
    let active = true;
    loadEnterpriseProjects(teamId).then(
      (items) => { if (active) setProjects(items.filter((project) => project.status === "active")); },
      () => { if (active) setProjects("error"); }
    );
    return () => { active = false; };
  }, [teamId]);

  const mine = useMemo(() => directory?.agents.filter((agent) => agent.ownerUserId === directory.selfUserId) ?? [], [directory]);
  if (!directory) return null;
  const canCreate = teamChatCanCreateAgent(directory) && mine.length < TEAM_CHAT_AGENT_LIMITS.perOwner;
  const trimmed = name.trim();

  const create = async () => {
    if (!trimmed || creating) return;
    setCreating(true);
    setError(undefined);
    try {
      await teamChat.createAgent({ name: trimmed, description: description.trim() });
      setName("");
      setDescription("");
    } catch (caught) {
      setError(teamChatErrorMessage(caught));
    } finally {
      setCreating(false);
    }
  };

  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal className={`modal-surface ${agentStyles.agentsModal}`}>
        <Dialog aria-label={copy.agentsTitle} className={agentStyles.agentsDialog!}>
          <Heading slot="title">{copy.agentsTitle}</Heading>
          <p className={agentStyles.disclosure}>{copy.agentsIntro}</p>
          {canCreate ? (
            <form className={agentStyles.createRow} onSubmit={(event) => { event.preventDefault(); void create(); }}>
              <label className={styles.field}>
                <span>{copy.agentName}</span>
                <input maxLength={TEAM_CHAT_AGENT_LIMITS.name * 2} onChange={(event) => setName(event.currentTarget.value)} value={name} />
              </label>
              <label className={styles.field}>
                <span>{copy.agentDescription}</span>
                <input maxLength={TEAM_CHAT_AGENT_LIMITS.description} onChange={(event) => setDescription(event.currentTarget.value)} value={description} />
              </label>
              <Button className="primary-button" isDisabled={!trimmed || creating} type="submit">
                {creating ? copy.agentCreating : copy.agentCreate}
              </Button>
            </form>
          ) : !teamChatCanCreateAgent(directory) ? <p className={agentStyles.disclosure}>{copy.agentCreateRestricted}</p> : null}
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          {mine.length === 0 ? <p className={agentStyles.disclosure}>{copy.agentNoneOwned}</p> : mine.map((agent) => (
            <TeamChatAgentCard
              activity={host?.activity.filter((item) => item.agentUserId === agent.userId) ?? []}
              agent={agent}
              binding={host?.bindings.find((item) => item.agentUserId === agent.userId)}
              directory={directory}
              key={agent.userId}
              projects={projects}
            />
          ))}
          <div className={`${styles.dialogActions} ${agentStyles.stickyActions}`}>
            <Button className="primary-button" onPress={onClose}>{copy.close}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

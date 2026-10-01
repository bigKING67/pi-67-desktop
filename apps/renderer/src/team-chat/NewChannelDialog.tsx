import { useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { TEAM_CHAT_CHANNEL_NAME_MAX_CHARS, teamChatCodePointLength, type TeamChatVisibility } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import { TeamChatAgentAvatar, TeamChatAgentBadge, TeamChatAvatar } from "./TeamChatParts.js";
import styles from "./TeamChat.module.css";

export function NewChannelDialog({ onClose }: { onClose: () => void }) {
  const copy = messages.teamChat;
  const directory = useTeamChat((state) => state.directory);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<TeamChatVisibility>("public");
  const [members, setMembers] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  // Agents can join channels too, so teammates can @mention them there (ADR 0004).
  const teammates = directory ? [
    ...directory.members.filter((member) => member.userId !== directory.selfUserId),
    ...directory.agents.filter((agent) => agent.status === "active").map((agent) => ({ userId: agent.userId, displayName: agent.name, agent: true }))
  ] : [];
  const valid = name.trim().length > 0 && teamChatCodePointLength(name.trim()) <= TEAM_CHAT_CHANNEL_NAME_MAX_CHARS;

  const create = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await teamChat.createChannel({ name: name.trim(), visibility, memberUserIds: [...members] });
      onClose();
    } catch (caught) {
      setError(teamChatErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalOverlay className="modal-overlay" isDismissable={!saving} isOpen onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <Modal className={`modal-surface ${styles.channelModal}`}>
        <Dialog aria-label={copy.newChannelTitle} className={styles.channelDialog!}>
          <Heading slot="title">{copy.newChannelTitle}</Heading>
          <form className={styles.channelForm} onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <label className={styles.field}>
              <span>{copy.channelName}</span>
              <input
                autoFocus
                maxLength={TEAM_CHAT_CHANNEL_NAME_MAX_CHARS * 2}
                onChange={(event) => setName(event.currentTarget.value)}
                required
                value={name}
              />
              <small>{copy.channelNameHint}</small>
            </label>
            <fieldset className={styles.visibility}>
              <legend>{copy.visibility}</legend>
              {(["public", "private"] as const).map((value) => (
                <label className={visibility === value ? styles.visibilitySelected : undefined} key={value}>
                  <input checked={visibility === value} name="team-chat-visibility" onChange={() => setVisibility(value)}
                    type="radio" value={value} />
                  <span>
                    <strong>{value === "public" ? copy.publicChannel : copy.privateChannel}</strong>
                    <small>{value === "public" ? copy.publicChannelHint : copy.privateChannelHint}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            {teammates.length > 0 ? (
              <fieldset className={styles.memberPicker}>
                <legend>{copy.addTeammates}</legend>
                <div>
                  {teammates.map((member) => (
                    <label key={member.userId}>
                      <input
                        checked={members.has(member.userId)}
                        onChange={(event) => {
                          const next = new Set(members);
                          if (event.currentTarget.checked) next.add(member.userId);
                          else next.delete(member.userId);
                          setMembers(next);
                        }}
                        type="checkbox"
                      />
                      {"agent" in member ? <TeamChatAgentAvatar /> : <TeamChatAvatar name={member.displayName} />}
                      <span>{member.displayName}{"agent" in member ? <> <TeamChatAgentBadge /></> : null}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {error ? <p className={styles.formError} role="alert">{error}</p> : null}
            <div className={styles.dialogActions}>
              <Button className="secondary-button" isDisabled={saving} onPress={onClose}>{copy.cancel}</Button>
              <Button className="primary-button" isDisabled={saving || !valid} type="submit">
                {saving ? copy.creating : copy.create}
              </Button>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

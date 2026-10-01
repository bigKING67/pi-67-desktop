import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import {
  TEAM_CHAT_CHANNEL_NAME_MAX_CHARS,
  teamChatCanManageChannel,
  teamChatCodePointLength,
  type TeamChatChannelAction,
  type TeamChatChannelRoster,
  type TeamChatConversation,
  type TeamChatDirectory
} from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { memberById } from "./team-chat-model.js";
import { teamChat } from "./team-chat-instance.js";
import { TeamChatAvatar } from "./TeamChatParts.js";
import styles from "./TeamChat.module.css";
import governance from "./TeamChatGovernance.module.css";

/** A pending two-step action: the first press arms it, the second confirms. */
type Armed = { kind: "remove" | "owner"; userId: string } | { kind: "leave" | "archive" };

export function TeamChatChannelSettings({ conversation, directory, onClose }: {
  conversation: TeamChatConversation;
  directory: TeamChatDirectory;
  onClose: () => void;
}) {
  const copy = messages.teamChat;
  const channelName = conversation.name ?? "";
  const manager = teamChatCanManageChannel(directory, conversation);
  const [roster, setRoster] = useState<TeamChatChannelRoster | "error">();
  const [name, setName] = useState(channelName);
  const [addition, setAddition] = useState("");
  const [armed, setArmed] = useState<Armed>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = () => {
    teamChat.channelRoster(conversation.id).then(setRoster, () => setRoster("error"));
  };
  useEffect(load, [conversation.id, conversation.memberCount, conversation.ownerUserId]);

  /** Roster changes arrive through the directory (member count, owner), which re-reads the roster above. */
  const run = async (action: TeamChatChannelAction, done?: string, closeAfter = false): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    setArmed(undefined);
    try {
      await teamChat.manageChannel(conversation.id, action);
      if (done) publishNotification({ level: "success", title: done, message: `#${name.trim() || channelName}` });
      if (closeAfter) onClose();
      return true;
    } catch (caught) {
      setError(teamChatErrorMessage(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const displayName = (userId: string) => {
    const name = memberById(directory, userId)?.displayName ?? copy.unknownTeammate;
    return userId === directory.selfUserId ? `${name}（${copy.you}）` : name;
  };
  const members = roster && roster !== "error" ? roster.members : [];
  const ownerUserId = roster && roster !== "error" ? roster.ownerUserId : conversation.ownerUserId;
  const inChannel = new Set(members.map((member) => member.userId));
  const addable = [
    ...directory.members,
    ...directory.agents.filter((agent) => agent.status === "active").map((agent) => ({ userId: agent.userId, displayName: `${agent.name}（${copy.agentBadge}）` }))
  ].filter((member) => !inChannel.has(member.userId));
  const trimmed = name.trim();
  const renamable = trimmed.length > 0 && trimmed !== channelName && teamChatCodePointLength(trimmed) <= TEAM_CHAT_CHANNEL_NAME_MAX_CHARS;
  const selfIsOwner = ownerUserId === directory.selfUserId;

  return (
    <ModalOverlay className="modal-overlay" isDismissable={!busy} isOpen onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Modal className={`modal-surface ${styles.channelModal}`}>
        <Dialog aria-label={copy.channelSettingsTitle(channelName)} className={styles.channelDialog!}>
          <Heading slot="title">{copy.channelSettingsTitle(channelName)}</Heading>
          {manager ? (
            <form className={governance.inlineRow} onSubmit={(event) => { event.preventDefault(); if (renamable) void run({ type: "rename", name: trimmed }, copy.channelRenamed); }}>
              <label className={styles.field}>
                <span>{copy.channelName}</span>
                <input maxLength={TEAM_CHAT_CHANNEL_NAME_MAX_CHARS * 2} onChange={(event) => setName(event.currentTarget.value)} value={name} />
              </label>
              <Button className="secondary-button" isDisabled={busy || !renamable} type="submit">{copy.channelRename}</Button>
            </form>
          ) : <p className={governance.hint}>{copy.channelManagerHint}</p>}

          <section aria-label={copy.channelMembers(members.length)} className={governance.roster}>
            <h3>{copy.channelMembers(roster && roster !== "error" ? members.length : conversation.memberCount)}</h3>
            {roster === undefined ? <p role="status">{copy.mentionLoading}</p> : null}
            {roster === "error" ? (
              <p className={styles.formError} role="alert">{copy.channelMembersFailed}
                <Button className={styles.textAction!} onPress={load}>{copy.retry}</Button></p>
            ) : null}
            <ul>
              {members.map((member) => {
                const label = displayName(member.userId);
                const owner = member.userId === ownerUserId;
                const self = member.userId === directory.selfUserId;
                const armedHere = armed && "userId" in armed && armed.userId === member.userId ? armed.kind : undefined;
                return (
                  <li key={member.userId}>
                    <TeamChatAvatar name={label} />
                    <span className={governance.rosterName}>{label}</span>
                    {owner ? <span className={governance.ownerChip}>{copy.channelOwner}</span> : null}
                    {manager && !owner && !self ? (
                      <span className={governance.rosterActions}>
                        <Button aria-label={armedHere === "owner" ? copy.channelConfirmOwner(label) : `${copy.channelMakeOwner} ${label}`}
                          className={`small-button ${armedHere === "owner" ? governance.armed : ""}`} isDisabled={busy}
                          onPress={() => armedHere === "owner" ? void run({ type: "transferOwner", userId: member.userId })
                            : setArmed({ kind: "owner", userId: member.userId })}>
                          {armedHere === "owner" ? copy.channelConfirmOwner(label) : copy.channelMakeOwner}
                        </Button>
                        <Button aria-label={armedHere === "remove" ? copy.channelConfirmRemove(label) : `${copy.channelRemove} ${label}`}
                          className={`small-button ${armedHere === "remove" ? governance.armedDanger : ""}`} isDisabled={busy}
                          onPress={() => armedHere === "remove" ? void run({ type: "removeMember", userId: member.userId })
                            : setArmed({ kind: "remove", userId: member.userId })}>
                          {armedHere === "remove" ? copy.channelConfirmRemove(label) : copy.channelRemove}
                        </Button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          {roster && roster !== "error" ? (
            addable.length === 0 ? <p className={governance.hint}>{copy.channelNoOneToAdd}</p> : (
              <form className={governance.inlineRow} onSubmit={(event) => {
                event.preventDefault();
                if (addition) void run({ type: "addMembers", userIds: [addition] }).then((added) => { if (added) setAddition(""); });
              }}>
                <label className={styles.field}>
                  <span>{copy.channelAddMember}</span>
                  <select onChange={(event) => setAddition(event.currentTarget.value)} value={addition}>
                    <option value="">{copy.channelAddMemberPlaceholder}</option>
                    {addable.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
                  </select>
                </label>
                <Button className="secondary-button" isDisabled={busy || !addition} type="submit">{copy.channelAdd}</Button>
              </form>
            )
          ) : null}

          {manager ? <p className={governance.hint}>{copy.channelArchiveHint}</p> : null}
          {selfIsOwner ? <p className={governance.hint}>{copy.channelOwnerMustTransfer}</p> : null}
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          <div className={`${styles.dialogActions} ${governance.footer}`}>
            {conversation.joined && !selfIsOwner ? (
              <Button className={`secondary-button ${armed?.kind === "leave" ? governance.armedDanger : ""}`} isDisabled={busy}
                onPress={() => armed?.kind === "leave" ? void run({ type: "leave" }, copy.channelLeave, true) : setArmed({ kind: "leave" })}>
                {armed?.kind === "leave" ? copy.channelConfirmLeave : copy.channelLeave}
              </Button>
            ) : null}
            {manager ? (
              <Button className={`secondary-button ${armed?.kind === "archive" ? governance.armedDanger : ""}`} isDisabled={busy}
                onPress={() => armed?.kind === "archive" ? void run({ type: "archive" }, copy.channelArchive, true) : setArmed({ kind: "archive" })}>
                {armed?.kind === "archive" ? copy.channelConfirmArchive : copy.channelArchive}
              </Button>
            ) : null}
            <span className={governance.spacer} />
            <Button className="primary-button" isDisabled={busy} onPress={onClose}>{copy.close}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

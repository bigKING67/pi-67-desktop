import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { TEAM_CHAT_WORK_CARD_LIMITS } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { SettingsSelect } from "../settings/SettingsPrimitives.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { useRepositoryEnvironmentStore } from "../worktree/repository-environment-store.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { useTeamChatDialogStore, type TeamChatHandoffSource } from "./team-chat-dialog-store.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import { currentBranchName, handoffReferences, isHandoffLink } from "./team-chat-work-bridge.js";
import styles from "./TeamChat.module.css";

/** Work -> Chat: send a reviewed Work Card; never the Session transcript. */
export function TeamChatHandoffDialog({ source }: { source: TeamChatHandoffSource }) {
  const copy = messages.teamChat;
  const close = useTeamChatDialogStore((state) => state.close);
  const directory = useTeamChat((state) => state.directory);
  const workspaceName = useWorkbenchStore((state) => state.workspaces[source.workspaceId]?.displayName);
  const branchName = useRepositoryEnvironmentStore((state) => currentBranchName(state.records[source.workspaceId]?.snapshot));
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState(source.title);
  const [goal, setGoal] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [summary, setSummary] = useState("");
  const [includeWorkspace, setIncludeWorkspace] = useState(true);
  const [includeBranch, setIncludeBranch] = useState(true);
  const [link, setLink] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => { teamChat.activate(); }, []);

  const channels = directory?.conversations.filter((item) => item.kind === "channel" && item.joined) ?? [];
  const teammates = directory?.members.filter((member) => member.userId !== directory.selfUserId) ?? [];
  const linkValid = isHandoffLink(link);
  const valid = Boolean(target) && title.trim().length > 0 && linkValid;

  const send = async () => {
    if (!valid || sending) return;
    setSending(true);
    setError(undefined);
    try {
      const [kind, id] = target.split(":", 2) as ["dm" | "conversation", string];
      const conversationId = kind === "dm" ? await teamChat.ensureDirectMessage(id) : id;
      await teamChat.createWorkCard(conversationId, {
        title: title.trim(),
        goal,
        acceptance,
        summary,
        refs: handoffReferences({
          ...(includeWorkspace && workspaceName ? { workspaceName } : {}),
          ...(includeBranch && branchName ? { branchName } : {}),
          link
        }),
        ...(kind === "dm" ? { assigneeUserId: id } : {})
      });
      const label = kind === "dm"
        ? teammates.find((member) => member.userId === id)?.displayName ?? copy.unknownTeammate
        : `#${channels.find((item) => item.id === id)?.name ?? ""}`;
      publishNotification({ level: "info", title: copy.handoffSent(label) });
      close();
    } catch (caught) {
      setError(teamChatErrorMessage(caught));
    } finally {
      setSending(false);
    }
  };

  return (
    <ModalOverlay className="modal-overlay" isDismissable={!sending} isOpen onOpenChange={(open) => { if (!open && !sending) close(); }}>
      <Modal className={`modal-surface ${styles.handoffModal}`}>
        <Dialog aria-label={copy.handoffTitle} className={styles.channelDialog!}>
          <Heading slot="title">{copy.handoffTitle}</Heading>
          {!directory ? <p className={styles.formNotice}>{copy.handoffSignedOut}</p> : (
            <form className={styles.channelForm} onSubmit={(event) => { event.preventDefault(); void send(); }}>
              <p className={styles.formNotice}>{copy.handoffPrivacy}</p>
              <div className={styles.field}>
                <span>{copy.handoffTarget}</span>
                {/* Teammates first, then #channels; the "#" prefix keeps the two kinds distinct in one flat list. */}
                <SettingsSelect className={styles.fieldSelect!} label={copy.handoffTarget} onChange={setTarget} value={target}
                  options={[{ id: "", label: "—", disabled: true },
                    ...teammates.map((member) => ({ id: `dm:${member.userId}`, label: member.displayName })),
                    ...channels.map((channel) => ({ id: `conversation:${channel.id}`, label: `#${channel.name}` }))]} />
                {teammates.length === 0 && channels.length === 0 ? <small>{copy.handoffNoTargets}</small> : null}
              </div>
              <label className={styles.field}>
                <span>{copy.handoffTitleField}</span>
                <input maxLength={TEAM_CHAT_WORK_CARD_LIMITS.title} onChange={(event) => setTitle(event.currentTarget.value)} required value={title} />
              </label>
              <TextAreaField label={copy.handoffGoal} maxLength={TEAM_CHAT_WORK_CARD_LIMITS.section} onChange={setGoal} value={goal} />
              <TextAreaField label={copy.handoffAcceptance} maxLength={TEAM_CHAT_WORK_CARD_LIMITS.section} onChange={setAcceptance} value={acceptance} />
              <TextAreaField label={copy.handoffSummary} maxLength={TEAM_CHAT_WORK_CARD_LIMITS.summary} onChange={setSummary}
                placeholder={copy.handoffSummaryPlaceholder} value={summary} />
              <fieldset className={`${styles.memberPicker} ${styles.refPicker}`}>
                <legend>{copy.workCardRefs}</legend>
                <div>
                  {workspaceName ? (
                    <label>
                      <input checked={includeWorkspace} onChange={(event) => setIncludeWorkspace(event.currentTarget.checked)} type="checkbox" />
                      <span>{copy.handoffIncludeWorkspace(workspaceName)}</span>
                    </label>
                  ) : null}
                  {branchName ? (
                    <label>
                      <input checked={includeBranch} onChange={(event) => setIncludeBranch(event.currentTarget.checked)} type="checkbox" />
                      <span>{copy.handoffIncludeBranch(branchName)}</span>
                    </label>
                  ) : null}
                </div>
              </fieldset>
              <label className={styles.field}>
                <span>{copy.handoffLink}</span>
                <input aria-invalid={!linkValid} inputMode="url" onChange={(event) => setLink(event.currentTarget.value)} value={link} />
                {!linkValid ? <small className={styles.fieldError}>{copy.handoffLinkInvalid}</small> : null}
              </label>
              {error ? <p className={styles.formError} role="alert">{error}</p> : null}
              <div className={styles.dialogActions}>
                <Button className="secondary-button" isDisabled={sending} onPress={close}>{copy.cancel}</Button>
                <Button className="primary-button" isDisabled={sending || !valid} type="submit">
                  {sending ? copy.handoffSending : copy.handoffSend}
                </Button>
              </div>
            </form>
          )}
          {!directory ? (
            <div className={styles.dialogActions}>
              <Button className="secondary-button" onPress={close}>{copy.cancel}</Button>
            </div>
          ) : null}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function TextAreaField({ label, value, onChange, maxLength, placeholder, rows = 3 }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <textarea maxLength={maxLength * 2} onChange={(event) => onChange(event.currentTarget.value)} placeholder={placeholder}
        rows={rows} value={value} />
    </label>
  );
}

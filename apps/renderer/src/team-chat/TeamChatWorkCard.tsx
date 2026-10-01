import { CircleCheck, CircleDashed, CircleDot, CircleSlash, Eye, Link2 } from "lucide-react";
import { useState } from "react";
import { Button } from "react-aria-components";
import {
  teamChatWorkCardActions,
  teamChatWorkCardBrief,
  type TeamChatDirectory,
  type TeamChatWorkCard,
  type TeamChatWorkCardAction
} from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { useTeamChatDialogStore } from "./team-chat-dialog-store.js";
import { teamChat } from "./team-chat-instance.js";
import { memberById } from "./team-chat-model.js";
import styles from "./TeamChat.module.css";

const STATUS_ICON = {
  todo: CircleDashed,
  in_progress: CircleDot,
  in_review: Eye,
  done: CircleCheck,
  closed: CircleSlash
} as const;

export function TeamChatWorkCard({ card, directory }: { card: TeamChatWorkCard; directory: TeamChatDirectory }) {
  const copy = messages.teamChat;
  const [pending, setPending] = useState<TeamChatWorkCardAction>();
  const actions = teamChatWorkCardActions(card, directory.selfUserId);
  const name = (userId: string | undefined) => userId === directory.selfUserId
    ? copy.you
    : memberById(directory, userId)?.displayName ?? copy.unknownTeammate;
  const owner = card.claimedBy !== undefined
    ? copy.workCardClaimedBy(name(card.claimedBy))
    : card.assigneeUserId !== undefined ? copy.workCardAssignee(name(card.assigneeUserId)) : copy.workCardUnassigned;
  const StatusIcon = STATUS_ICON[card.status];
  const canStartWork = card.claimedBy === directory.selfUserId && card.status === "in_progress";

  const act = (action: TeamChatWorkCardAction) => {
    setPending(action);
    void teamChat.actOnWorkCard(card, action)
      .then(() => { if (action === "claim") useTeamChatDialogStore.getState().openStartWork({ text: teamChatWorkCardBrief(card) }); })
      .catch((error: unknown) => publishNotification({ level: "warning", title: copy.workCardActionFailed, message: teamChatErrorMessage(error) }))
      .finally(() => setPending(undefined));
  };

  return (
    <section aria-label={`${copy.workCard}：${card.title}`} className={styles.workCard} data-status={card.status} data-testid="team-chat-work-card">
      <header>
        <span className={styles.workCardKind}>{copy.workCard}</span>
        <span className={styles.workCardStatus} data-status={card.status}>
          <StatusIcon aria-hidden="true" size={13} />{copy.workCardStatus[card.status]}
        </span>
      </header>
      <h3>{card.title}</h3>
      <p className={styles.workCardOwner}>{owner}</p>
      {card.goal.trim() ? <WorkCardSection label={copy.workCardGoal} text={card.goal} /> : null}
      {card.acceptance.trim() ? <WorkCardSection label={copy.workCardAcceptance} text={card.acceptance} /> : null}
      {card.summary.trim() ? <WorkCardSection label={copy.workCardSummary} text={card.summary} /> : null}
      {card.refs.length > 0 ? (
        <ul aria-label={copy.workCardRefs} className={styles.workCardRefs}>
          {card.refs.map((ref, index) => (
            <li key={`${ref.kind}-${index}`}>
              <Link2 aria-hidden="true" size={12} />
              {ref.url ? (
                <a
                  href={ref.url}
                  onClick={(event) => {
                    event.preventDefault();
                    void window.pi67.system.requestOpenExternal(ref.url!);
                  }}
                  rel="noreferrer noopener"
                >{ref.label}</a>
              ) : <span>{ref.label}</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {actions.length > 0 || canStartWork ? (
        <footer>
          {canStartWork ? (
            <Button className="primary-button" onPress={() => useTeamChatDialogStore.getState().openStartWork({ text: teamChatWorkCardBrief(card) })}>
              {copy.startWork}
            </Button>
          ) : null}
          {actions.map((action) => (
            <Button
              className={action === "claim" || (action === "accept" && !canStartWork) ? "primary-button" : "secondary-button"}
              isDisabled={pending !== undefined}
              key={action}
              onPress={() => act(action)}
            >{copy.workCardAction[action]}</Button>
          ))}
        </footer>
      ) : null}
    </section>
  );
}

function WorkCardSection({ label, text }: { label: string; text: string }) {
  return (
    <div className={styles.workCardSection}>
      <strong>{label}</strong>
      <p>{text}</p>
    </div>
  );
}

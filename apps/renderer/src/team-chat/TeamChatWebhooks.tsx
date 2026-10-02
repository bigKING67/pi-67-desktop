import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { TEAM_CHAT_WEBHOOK_NAME_MAX, type TeamChatWebhook } from "@pi67/domain";
import { useCopyFeedback } from "../clipboard/use-copy-feedback.js";
import { messages } from "../localization/message-catalog.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { teamChat } from "./team-chat-instance.js";
import { formatTeamChatTime } from "./team-chat-presentation.js";
import styles from "./TeamChat.module.css";
import agentStyles from "./TeamChatAgents.module.css";
import governance from "./TeamChatGovernance.module.css";

/**
 * A channel's incoming webhooks (ADR 0005), for its managers. The secret URL lives
 * only in this component's state after create/rotate and is gone once it closes.
 */
export function TeamChatWebhooks({ conversationId }: { conversationId: string }) {
  const copy = messages.teamChat;
  const [webhooks, setWebhooks] = useState<TeamChatWebhook[] | "error">();
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<{ botUserId: string; url: string }>();
  const [armed, setArmed] = useState<{ botUserId: string; action: "rotate" | "remove" }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { copyState, copyText } = useCopyFeedback();

  const load = () => { teamChat.listWebhooks(conversationId).then(setWebhooks, () => setWebhooks("error")); };
  useEffect(load, [conversationId]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setArmed(undefined);
    try {
      await action();
      load();
    } catch (caught) {
      setError(teamChatErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const trimmed = name.trim();

  return (
    <section aria-label={copy.webhooks} className={`${agentStyles.hostSection} ${agentStyles.closedSection}`}>
      <h3>{copy.webhooks}</h3>
      <p className={agentStyles.disclosure}>{copy.webhooksIntro}</p>
      <form className={governance.inlineRow} onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) void run(async () => {
          const created = await teamChat.createWebhook(conversationId, trimmed);
          setRevealed({ botUserId: created.webhook.botUserId, url: created.url });
          setName("");
        });
      }}>
        <label className={styles.field}>
          <span>{copy.webhookName}</span>
          <input maxLength={TEAM_CHAT_WEBHOOK_NAME_MAX * 2} onChange={(event) => setName(event.currentTarget.value)} value={name} />
        </label>
        <Button className="secondary-button" isDisabled={busy || !trimmed} type="submit">{busy ? copy.webhookCreating : copy.webhookCreate}</Button>
      </form>
      {revealed ? (
        <div className={agentStyles.secret} data-testid="team-chat-webhook-secret">
          <p className={agentStyles.disclosure}>{copy.webhookUrlOnce}</p>
          <input aria-label={copy.webhookUrl} className={agentStyles.secretValue} readOnly title={revealed.url} value={revealed.url}
            onFocus={(event) => event.currentTarget.select()} />
          <div className={agentStyles.actions}>
            <Button className="secondary-button" onPress={() => void copyText(revealed.url)}>
              {copyState === "copied" ? copy.webhookCopied : copy.webhookCopy}
            </Button>
          </div>
          <p className={agentStyles.disclosure}>{copy.webhookUsage}</p>
        </div>
      ) : null}
      {webhooks === "error" ? <p className={styles.formError} role="alert">{copy.genericError}</p> : null}
      {Array.isArray(webhooks) && webhooks.length === 0 ? <p className={agentStyles.disclosure}>{copy.webhookNone}</p> : null}
      {Array.isArray(webhooks) && webhooks.length > 0 ? (
        <ul className={agentStyles.webhookList}>
          {webhooks.map((webhook) => {
            const armedHere = armed?.botUserId === webhook.botUserId ? armed.action : undefined;
            return (
              <li key={webhook.botUserId}>
                <span className={governance.rosterName}>{webhook.name}</span>
                <small className={agentStyles.rowMeta}>
                  {`· ${webhook.lastUsedAt === undefined ? copy.webhookNeverUsed : copy.webhookLastUsed(formatTeamChatTime(webhook.lastUsedAt))}`}
                </small>
                <span className={governance.rosterActions}>
                  <Button className={`small-button ${armedHere === "rotate" ? governance.armed ?? "" : ""}`} isDisabled={busy}
                    aria-label={armedHere === "rotate" ? `${copy.webhookConfirmRotate} ${webhook.name}` : `${copy.webhookRotate} ${webhook.name}`}
                    onPress={() => armedHere === "rotate"
                      ? void run(async () => {
                        const rotated = await teamChat.rotateWebhook(conversationId, webhook.botUserId);
                        setRevealed({ botUserId: webhook.botUserId, url: rotated.url });
                      })
                      : setArmed({ botUserId: webhook.botUserId, action: "rotate" })}>
                    {armedHere === "rotate" ? copy.webhookConfirmRotate : copy.webhookRotate}
                  </Button>
                  <Button className={`small-button ${armedHere === "remove" ? governance.armedDanger ?? "" : ""}`} isDisabled={busy}
                    aria-label={armedHere === "remove" ? `${copy.webhookConfirmRemove} ${webhook.name}` : `${copy.webhookRemove} ${webhook.name}`}
                    onPress={() => armedHere === "remove"
                      ? void run(async () => {
                        await teamChat.removeWebhook(conversationId, webhook.botUserId);
                        if (revealed?.botUserId === webhook.botUserId) setRevealed(undefined);
                      })
                      : setArmed({ botUserId: webhook.botUserId, action: "remove" })}>
                    {armedHere === "remove" ? copy.webhookConfirmRemove : copy.webhookRemove}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
    </section>
  );
}

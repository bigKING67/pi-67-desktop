import { ChevronDown, ListPlus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectFollowUpQueue,
  selectSteeringQueue
} from "../session/session-projection-selectors.js";
import { projectQueue, type QueueItemView } from "./composer-queue-projection.js";
import { clearRendererQueue } from "./queue-controller.js";
import styles from "./Composer.module.css";

export function ComposerQueuePanel() {
  const steeringQueue = useSessionProjectionStore(selectSteeringQueue);
  const followUpQueue = useSessionProjectionStore(selectFollowUpQueue);
  const [expanded, setExpanded] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [clearing, setClearing] = useState(false);
  const projection = useMemo(() => projectQueue(
    steeringQueue ?? [],
    followUpQueue ?? []
  ), [followUpQueue, steeringQueue]);
  const count = projection.steeringCount + projection.followUpCount;

  useEffect(() => {
    setClearArmed(false);
    if (count === 0) setExpanded(false);
  }, [count]);

  if (count === 0) return null;

  const requestClear = async () => {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearing(true);
    try {
      if (await clearRendererQueue()) {
        setExpanded(false);
        setClearArmed(false);
      }
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className={styles.queuePanel} aria-label={messages.composer.queue}>
      <div className={styles.queueHeader}>
        <Button
          aria-controls="queued-messages"
          aria-expanded={expanded}
          className={styles.queueToggle!}
          onPress={() => {
            setExpanded((current) => !current);
            setClearArmed(false);
          }}
        >
          <ListPlus aria-hidden="true" size={15} />
          <span>
            <strong>{messages.composer.queueSummary(
              projection.steeringCount,
              projection.followUpCount
            )}</strong>
            <small>{expanded ? messages.composer.collapseQueue : messages.composer.inspectQueue}</small>
          </span>
          <ChevronDown aria-hidden="true" className={expanded ? styles.queueChevronExpanded! : ""} size={15} />
        </Button>
        {expanded ? (
          <div className={styles.queueActions}>
            {clearArmed ? (
              <Button
                className={styles.queueCancelButton!}
                isDisabled={clearing}
                onPress={() => setClearArmed(false)}
              >{messages.common.cancel}</Button>
            ) : null}
            <Button
              className={clearArmed ? styles.queueConfirmButton! : styles.queueClearButton!}
              isDisabled={clearing}
              onPress={() => void requestClear()}
            >
              <Trash2 aria-hidden="true" size={13} />
              {clearing
                ? messages.composer.clearingQueue
                : clearArmed
                  ? messages.composer.confirmClearQueue
                  : messages.composer.clearQueue}
            </Button>
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div className={styles.queueContents} id="queued-messages">
          <QueueGroup items={projection.items.filter((item) => item.kind === "steer")} label={messages.composer.steer} />
          <QueueGroup items={projection.items.filter((item) => item.kind === "follow-up")} label={messages.composer.followUp} />
          {projection.hiddenCount > 0 ? (
            <p className={styles.queueLimitNotice}>{messages.composer.hiddenQueueItems(projection.hiddenCount)}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function QueueGroup({ items, label }: { items: QueueItemView[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <section className={styles.queueGroup} aria-label={label}>
      <h3>{label}</h3>
      <ol>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.preview || messages.composer.emptyQueueItem}</span>
            {item.truncated ? <small>{messages.composer.queueItemTruncated}</small> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

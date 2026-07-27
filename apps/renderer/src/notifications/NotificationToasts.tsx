import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import {
  type NotificationItem,
  type NotificationLevel,
  useNotificationStore
} from "./notification-store.js";
import styles from "./NotificationToasts.module.css";

const TOAST_LIFETIME_MS: Partial<Record<NotificationLevel, number>> = {
  info: 6_000,
  success: 6_000,
  warning: 10_000
};

export function NotificationToasts() {
  const items = useNotificationStore((state) => state.items);
  const toastIds = useNotificationStore((state) => state.toastIds);
  const byId = new Map(items.map((item) => [item.id, item]));
  const toasts = toastIds
    .map((id) => byId.get(id))
    .filter((item): item is NotificationItem => item !== undefined);

  return (
    <div aria-label="通知" className={styles.stack}>
      {toasts.map((toast) => <NotificationToast item={toast} key={toast.id} />)}
    </div>
  );
}

function NotificationToast({ item }: { item: NotificationItem }) {
  const dismissToast = useNotificationStore((state) => state.dismissToast);
  const [interactionPaused, setInteractionPaused] = useState(false);
  useAutoDismiss(item.id, TOAST_LIFETIME_MS[item.level], interactionPaused);

  return (
    <section
      className={`${styles.toast} ${styles[item.level]}`}
      data-notification-id={item.id}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setInteractionPaused(false);
      }}
      onFocusCapture={() => setInteractionPaused(true)}
      onPointerEnter={() => setInteractionPaused(true)}
      onPointerLeave={() => setInteractionPaused(false)}
      role={item.level === "error" ? "alert" : "status"}
    >
      <NotificationIcon level={item.level} />
      <span className={styles.copy}>
        <strong>{item.title}</strong>
        {item.message ? <span>{item.message}</span> : null}
      </span>
      <Button
        aria-label={`关闭通知：${item.title}`}
        className={styles.close!}
        onPress={() => dismissToast(item.id)}
      >
        <X aria-hidden="true" size={15} />
      </Button>
    </section>
  );
}

function NotificationIcon({ level }: { level: NotificationLevel }) {
  const className = styles.icon;
  if (level === "success") return <CircleCheck aria-hidden="true" className={className} size={17} />;
  if (level === "warning") return <CircleAlert aria-hidden="true" className={className} size={17} />;
  if (level === "error") return <TriangleAlert aria-hidden="true" className={className} size={17} />;
  return <Info aria-hidden="true" className={className} size={17} />;
}

function useAutoDismiss(id: string, duration: number | undefined, interactionPaused: boolean): void {
  const dismissToast = useNotificationStore((state) => state.dismissToast);
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden);
  const remainingRef = useRef(duration ?? 0);

  useEffect(() => {
    remainingRef.current = duration ?? 0;
  }, [duration, id]);

  useEffect(() => {
    const handleVisibilityChange = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (duration === undefined || interactionPaused || !documentVisible || remainingRef.current <= 0) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => dismissToast(id), remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [dismissToast, documentVisible, duration, id, interactionPaused]);
}

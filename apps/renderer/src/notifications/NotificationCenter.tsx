import { Bell } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { LazySurfaceBoundary } from "../app/LazySurfaceBoundary.js";
import { useNotificationStore } from "./notification-store.js";
import styles from "./NotificationCenter.module.css";

const loadNotificationCenterDialog = () => import("./NotificationCenterDialog.js");
const NotificationCenterDialog = lazy(() => loadNotificationCenterDialog().then((module) => ({
  default: module.NotificationCenterDialog
})));

export function NotificationCenter() {
  const items = useNotificationStore((state) => state.items);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const unreadCount = items.reduce((count, item) => count + (item.read ? 0 : 1), 0);
  const triggerLabel = unreadCount === 0
    ? "打开通知中心"
    : `打开通知中心，${unreadCount} 条未读`;
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <>
      <button
        aria-describedby="notification-center-tooltip"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        className={`icon-button ${styles.trigger}`}
        onClick={() => {
          markAllRead();
          setOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        <Bell aria-hidden="true" size={16} />
        {unreadCount > 0 ? (
          <span aria-hidden="true" className={styles.badge}>{unreadCount > 9 ? "9+" : unreadCount}</span>
        ) : null}
        <span className={styles.tooltip} id="notification-center-tooltip" role="tooltip">通知</span>
      </button>
      {open ? (
        <LazySurfaceBoundary
          description="通知记录仍保留在本次运行中。关闭后可以重新打开通知中心。"
          kind="overlay"
          onDismiss={close}
          surface="notification-center"
          title="通知中心未能加载"
        >
          <Suspense fallback={null}>
            <NotificationCenterDialog onOpenChange={(nextOpen) => {
              if (!nextOpen) close();
            }} triggerRef={triggerRef} />
          </Suspense>
        </LazySurfaceBoundary>
      ) : null}
    </>
  );
}

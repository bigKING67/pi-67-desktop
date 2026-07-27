import { useLayoutEffect, useRef } from "react";
import { Composer } from "../composer/Composer.js";
import { ContextPane } from "../context/ContextPane.js";
import { NavigationRail } from "../navigation/NavigationRail.js";
import { OperationStatusBar } from "../operation/OperationStatusBar.js";
import { Transcript } from "../transcript/Transcript.js";
import { TrustBanner } from "../workspace/TrustBanner.js";
import styles from "./WorkspaceShell.module.css";

interface WorkspaceShellProps {
  contextVisible: boolean;
  navigationIsDrawer: boolean;
  navigationVisible: boolean;
  onCloseContextDrawer: () => void;
  onCloseNavigation: () => void;
}

export function WorkspaceShell({
  contextVisible,
  navigationIsDrawer,
  navigationVisible,
  onCloseContextDrawer,
  onCloseNavigation
}: WorkspaceShellProps) {
  const navigationRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (!navigationIsDrawer || !navigationVisible) return;
    const drawer = navigationRef.current;
    if (!drawer) return;
    const focusFirst = () => drawer.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    focusFirst();
    const frame = window.requestAnimationFrame(() => {
      if (!drawer.contains(document.activeElement)) focusFirst();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseNavigation();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    drawer.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      drawer.removeEventListener("keydown", onKeyDown);
    };
  }, [navigationIsDrawer, navigationVisible, onCloseNavigation]);

  return (
    <main className={`workspace-grid ${contextVisible ? "has-context" : "context-hidden"} ${navigationVisible ? styles.navigationVisible : styles.navigationHidden}`}>
      <NavigationRail containerRef={navigationRef} />
      {navigationIsDrawer && navigationVisible ? (
        <button
          aria-label="关闭会话导航"
          className={styles.navigationDrawerScrim}
          onClick={onCloseNavigation}
          type="button"
        />
      ) : null}
      <section className="conversation-region" aria-label="Pi conversation">
        <TrustBanner />
        <Transcript />
        <OperationStatusBar />
        <Composer />
      </section>
      {contextVisible ? (
        <>
          <button
            aria-label="关闭上下文抽屉"
            className="context-drawer-scrim"
            onClick={onCloseContextDrawer}
            type="button"
          />
          <ContextPane />
        </>
      ) : null}
    </main>
  );
}

const FOCUSABLE_SELECTOR = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./App.module.css";

type LazySurfaceKind = "workspace" | "blocking-overlay" | "overlay";

interface LazySurfaceBoundaryProps {
  children: ReactNode;
  description: string;
  kind: LazySurfaceKind;
  onDismiss?: () => void;
  surface: string;
  title: string;
}

interface LazySurfaceBoundaryState {
  error?: Error;
}

export class LazySurfaceBoundary extends Component<LazySurfaceBoundaryProps, LazySurfaceBoundaryState> {
  state: LazySurfaceBoundaryState = {};

  static getDerivedStateFromError(error: unknown): LazySurfaceBoundaryState {
    return { error: normalizeSurfaceError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Renderer lazy surface failed.", {
      code: "RENDERER_SURFACE_LOAD_FAILED",
      surface: this.props.surface,
      message: normalizeSurfaceError(error).message,
      component: firstComponentName(info.componentStack)
    });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <LazySurfaceFailure {...this.props} error={error} />;
  }
}

function LazySurfaceFailure({
  description,
  error,
  kind,
  onDismiss,
  surface,
  title
}: Omit<LazySurfaceBoundaryProps, "children"> & { error: Error }) {
  const details = `RENDERER_SURFACE_LOAD_FAILED\nSurface: ${surface}\n${error.message}`;
  const content = (
    <section
      aria-describedby={`lazy-surface-description-${surface}`}
      aria-labelledby={`lazy-surface-title-${surface}`}
      aria-modal={kind === "workspace" ? undefined : "true"}
      className={`${styles.surfaceFailure} ${kind === "workspace" ? styles.workspaceFailure : styles.overlayFailure}`}
      data-lazy-surface-error={surface}
      role={kind === "workspace" ? "alert" : "alertdialog"}
    >
      <span className={styles.surfaceFailureEyebrow}>界面恢复</span>
      <h2 id={`lazy-surface-title-${surface}`}>{title}</h2>
      <p id={`lazy-surface-description-${surface}`}>{description}</p>
      <label className={styles.surfaceFailureDetails}>
        <span>可复制的错误详情</span>
        <textarea aria-label="界面加载错误详情" readOnly rows={4} value={details} />
      </label>
      <div className={styles.surfaceFailureActions}>
        {onDismiss ? (
          <button autoFocus className="secondary-button" onClick={onDismiss} type="button">
            关闭
          </button>
        ) : null}
        <button
          autoFocus={!onDismiss}
          className="primary-button"
          onClick={() => window.location.reload()}
          type="button"
        >
          重新加载界面
        </button>
      </div>
    </section>
  );

  return kind === "workspace"
    ? <main className={styles.workspaceFailureRegion}>{content}</main>
    : <div className={`modal-overlay ${styles.surfaceFailureOverlay}`}>{content}</div>;
}

function normalizeSurfaceError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.replace(/\s+/gu, " ").trim().slice(0, 800);
  return new Error(normalized || "界面模块未返回可识别的错误信息。");
}

function firstComponentName(componentStack: string | null | undefined): string | undefined {
  return componentStack?.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 160);
}

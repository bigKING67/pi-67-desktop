import { useSessionProjectionStore } from "../session/session-projection-store.js";
import styles from "../app/SessionScopePicker.module.css";
import type { SessionMemoryOrigin as MemoryOrigin } from "@pi67/domain";

export function SessionMemoryOrigin() {
  const origin = useSessionProjectionStore((state) => state.identity?.memoryOrigin);
  return <SessionMemoryOriginLabel origin={origin} />;
}

/**
 * Only a team origin carries an actionable boundary (continuing still needs current
 * permission). Private and unverified origins are the quiet default: memory capture
 * already fails closed for unverified history, so neither earns a persistent line.
 */
export function SessionMemoryOriginLabel({ origin }: { origin: MemoryOrigin | undefined }) {
  if (origin?.kind !== "team") return null;
  return <p className={styles.origin} aria-label="会话来源">
    {`团队会话 · ${origin.teamId} / ${origin.projectId} · 继续处理仍需当前权限`}
  </p>;
}

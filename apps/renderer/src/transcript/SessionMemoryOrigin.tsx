import { useSessionProjectionStore } from "../session/session-projection-store.js";
import styles from "../app/SessionScopePicker.module.css";
import type { SessionMemoryOrigin as MemoryOrigin } from "@pi67/domain";

export function SessionMemoryOrigin() {
  const origin = useSessionProjectionStore((state) => state.identity?.memoryOrigin);
  return <SessionMemoryOriginLabel origin={origin} />;
}

export function SessionMemoryOriginLabel({ origin }: { origin: MemoryOrigin | undefined }) {
  return <p className={styles.origin} aria-label="会话来源">
    {origin?.kind === "team" ? `团队会话 · ${origin.teamId} / ${origin.projectId} · 继续处理仍需当前权限`
      : origin?.kind === "private" ? "私人会话 · 不接入团队知识"
      : "会话来源未验证 · 不代表私人记忆归属"}
  </p>;
}

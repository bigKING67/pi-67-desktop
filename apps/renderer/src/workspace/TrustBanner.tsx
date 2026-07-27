import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectHasSession } from "../session/session-projection-selectors.js";
import { updateWorkspaceTrust } from "./workspace-trust-controller.js";

export function TrustBanner() {
  const trust = useAppStore((state) => state.trust);
  const connected = useAppStore((state) => state.connected);
  const runtime = useAppStore((state) => state.runtime);
  const hasSession = useSessionProjectionStore(selectHasSession);
  const trustUpdating = useAppStore((state) => state.trustUpdating);
  if (trust === "trusted") return null;

  const waitingForSession = !connected || !hasSession || runtime.phase === "starting" || runtime.phase === "recovering";
  const buttonLabel = trustUpdating
    ? "正在加载 Pi 资源…"
    : !connected
      ? "等待 Agent Host…"
      : !hasSession || runtime.phase === "starting" || runtime.phase === "recovering"
        ? "等待 Pi 会话…"
        : runtime.phase === "failed"
          ? "重新加载 Pi 资源"
          : "信任并加载资源";

  return (
    <div className="trust-banner" role="status" aria-busy={trustUpdating}>
      <ShieldAlert size={17} />
      <div>
        <strong>工作区尚未信任</strong>
        <span>项目级 Extensions、Skills、AGENTS.md 和写入工具保持禁用。</span>
      </div>
      <Button
        className="secondary-button"
        isDisabled={trustUpdating || waitingForSession}
        onPress={() => void updateWorkspaceTrust("trusted")}
      >
        <ShieldCheck size={15} /> {buttonLabel}
      </Button>
    </div>
  );
}

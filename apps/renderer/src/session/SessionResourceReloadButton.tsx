import { RefreshCw } from "lucide-react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import {
  currentSessionResourceTask,
  reloadSessionResources,
  sessionResourceReloadUnavailableReason
} from "./session-control-controller.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";

export function SessionResourceReloadButton({ compact = false }: { compact?: boolean }) {
  const connected = useAppStore((state) => state.connected);
  const hostEpoch = useAppStore((state) => state.hostEpoch);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const projectionAuthority = useSessionProjectionStore((state) => state.authority);
  const task = useWorkbenchStore(currentSessionResourceTask);
  const unavailable = sessionResourceReloadUnavailableReason(
    { connected, hostEpoch, sessionTransitionPending },
    projectionAuthority,
    task
  );

  return (
    <Button
      aria-label={unavailable
        ? `重新加载不可用：${unavailable}`
        : "重新加载当前会话的 Pi 资源"}
      className={compact ? "small-button" : "secondary-button"}
      isDisabled={unavailable !== undefined}
      onPress={() => void reloadSessionResources()}
    >
      {compact ? null : <RefreshCw aria-hidden="true" size={14} />}
      重新加载
    </Button>
  );
}

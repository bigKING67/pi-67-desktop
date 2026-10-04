import { isAgentHostOwnerMessage, type TeamModelRelayPort } from "@pi67/protocol";

interface ParentMessageEvent { data: unknown; ports: TeamModelRelayPort[] }

/** Install before asynchronous startup: parentPort itself has no disconnect event. */
export function watchAgentHostOwner(
  parent: { on(type: "message", listener: (event: ParentMessageEvent) => void): void },
  onLost: () => void,
  forceExit: () => void
): () => void {
  let owner: TeamModelRelayPort | undefined;
  let stopped = false;
  const dispose = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(deadline);
    owner?.off("close", lost);
    owner?.close();
  };
  const lost = (): void => {
    if (stopped) return;
    dispose();
    // Main's watchdog is gone; keep disposal from leaving this utility orphaned.
    const exitDeadline = setTimeout(forceExit, 1_250);
    exitDeadline.unref();
    onLost();
  };
  // Covers Main dying between fork and transfer without imposing a startup deadline.
  const deadline = setTimeout(lost, 10_000);
  parent.on("message", ({ data, ports }) => {
    if (!data || typeof data !== "object" || !("type" in data) || data.type !== "agent-host-owner") return;
    if (stopped || owner || !isAgentHostOwnerMessage(data) || ports.length !== 1) {
      for (const port of ports) port.close();
      if (!stopped && !owner) lost();
      return;
    }
    owner = ports[0]!;
    clearTimeout(deadline);
    owner.on("close", lost);
    owner.start?.();
  });
  return dispose;
}

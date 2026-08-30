export interface AgentPortHandoff {
  source: "pi67-preload";
  type: "agent-port";
  appInstanceId: string;
  hostEpoch: number;
}

export interface AgentPortHandoffTarget {
  readonly source: MessageEventSource;
  readonly origin: string;
  addMessageListener(listener: (event: MessageEvent) => void): void;
  removeMessageListener(listener: (event: MessageEvent) => void): void;
}

export function isAgentPortHandoff(value: unknown): value is AgentPortHandoff {
  if (typeof value !== "object" || value === null) return false;
  const handoff = value as Partial<AgentPortHandoff>;
  return handoff.source === "pi67-preload"
    && handoff.type === "agent-port"
    && typeof handoff.appInstanceId === "string"
    && handoff.appInstanceId.length > 0
    && handoff.appInstanceId.length <= 512
    && Number.isSafeInteger(handoff.hostEpoch)
    && Number(handoff.hostEpoch) >= 0;
}

export function createBrowserAgentPortHandoffTarget(): AgentPortHandoffTarget | undefined {
  if (typeof window === "undefined") return undefined;
  return {
    source: window,
    origin: window.location.origin,
    addMessageListener: (listener) => window.addEventListener("message", listener),
    removeMessageListener: (listener) => window.removeEventListener("message", listener)
  };
}

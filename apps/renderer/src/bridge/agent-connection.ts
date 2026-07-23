import { AgentPortClient } from "@pi67/protocol";

type ConnectionListener = (client: AgentPortClient) => void;

let subscriber: ConnectionListener | undefined;
let queuedPort: MessagePort | undefined;

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.data?.source !== "pi67-preload" || event.data?.type !== "agent-port") return;
  const port = event.ports[0];
  if (!port) return;
  if (subscriber) {
    subscriber(new AgentPortClient(port));
    return;
  }
  queuedPort?.close();
  queuedPort = port;
});

export function subscribeToAgentConnections(listener: ConnectionListener): () => void {
  subscriber = listener;
  if (queuedPort) {
    const port = queuedPort;
    queuedPort = undefined;
    listener(new AgentPortClient(port));
  }
  return () => {
    if (subscriber === listener) subscriber = undefined;
  };
}

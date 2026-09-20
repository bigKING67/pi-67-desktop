import type { TeamModelRelayPort } from "@pi67/protocol";
import { TeamModelPortAdmission } from "../../apps/agent-host/src/context/team-model-port-admission.js";

// Isolated utility process: transport-only synthetic echo, not model authorization.
const parent = (process as NodeJS.Process & { parentPort: {
  on(type: "message", callback: (event: { data: unknown; ports: TeamModelRelayPort[] }) => void): void;
  postMessage(value: unknown): void;
} }).parentPort;
const admission = new TeamModelPortAdmission();
parent.on("message", event => { admission.handleMessage(event); });
const reservation = admission.reserve(channel => {
  channel.on("data", (bytes: Buffer) => { channel.write(bytes); });
  channel.once("close", () => parent.postMessage({ type: "probe-closed" }));
  return { stop() { channel.destroy(); } };
}, new AbortController().signal);
void reservation.connected.catch(() => undefined);
parent.postMessage({ type: "probe-reserved", requestId: reservation.requestId });
process.once("SIGTERM", () => { admission.shutdown(); process.exit(0); });

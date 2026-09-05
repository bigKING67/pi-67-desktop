import { createRoot } from "react-dom/client";
import { ExperienceInspectorPanel } from "./ExperienceInspectorPanel.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";

let resolveWorkspaceA: (value: unknown) => void = () => undefined;
const workspaceA = new Promise((resolve) => { resolveWorkspaceA = resolve; });
Object.defineProperty(agentConnectionController, "identity", {
  get: () => ({ appInstanceId: "fixture", hostInstanceId: "fixture", hostEpoch: 1 })
});
agentConnectionController.request = (async (type, _payload, _ports, options) => {
  if (type === "enterprise.workspace.get") {
    return options?.context?.scope === "workspace" && options.context.workspaceId === "workspace-a"
      ? workspaceA
      : { state: "unbound" };
  }
  if (type === "enterprise.identity.get") return { state: "signed-in" };
  if (type === "experience.private.list") return { items: [] };
  return {};
}) as typeof agentConnectionController.request;
rendererWorkbenchStore.setState({ currentWorkspaceId: "workspace-a" });
const container = document.getElementById("fixture-root");
if (!container) throw new Error("Missing fixture root");
createRoot(container).render(<ExperienceInspectorPanel />);

document.getElementById("switch-workspace")?.addEventListener("click", () => {
  rendererWorkbenchStore.setState({ currentWorkspaceId: "workspace-b" });
});
document.getElementById("resolve-old-workspace")?.addEventListener("click", () => {
  resolveWorkspaceA({ state: "bound", enterpriseProjectId: "project-a" });
  setTimeout(() => { document.body.dataset.oldResponse = "settled"; }, 100);
});

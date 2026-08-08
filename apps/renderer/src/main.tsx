import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { initializeThemeController } from "./theme/theme-controller.js";
import { initializeRendererWorkbench } from "./workbench/workbench-controller.js";
import { initializeTaskDraftPersistence } from "./workbench/task-draft-persistence.js";
import { initializeWorkspaceFilePersistence } from "./workspace-files/workspace-file-persistence.js";
import { initializeNativeNotificationController } from "./notifications/native-notification-controller.js";
import { reconcileRendererWorktreeCreations } from "./worktree/worktree-creation-recovery-controller.js";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/dialogs.css";

const root = document.getElementById("root");
if (!root) throw new Error("Pi-67 renderer root was not found.");

initializeThemeController();
const workbenchInitialization = initializeRendererWorkbench();
initializeNativeNotificationController(workbenchInitialization);
void workbenchInitialization
  .then(() => initializeTaskDraftPersistence())
  .then(() => reconcileRendererWorktreeCreations());
void initializeWorkspaceFilePersistence();

void window.pi67.system.getPlatformInfo().then((info) => {
  document.documentElement.dataset.platform = info.platform;
});

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

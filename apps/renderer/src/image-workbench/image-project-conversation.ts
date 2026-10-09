import { formatImagePromptContext } from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { setComposerPromptContext } from "../composer/composer-prompt-context.js";
import { rendererWorkbenchStore, selectedWorkbenchTask } from "../workbench/workbench-store.js";
import { beginRendererSessionIntentInWorkspace } from "../workspace/workspace-session-controller.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { useImageProject } from "./image-project-controller.js";

// The image page's dock hosts one ordinary Pi conversation per project, in the
// library Workspace. The app renders one live conversation (the selected task),
// so opening a project selects its conversation; choosing anything outside the
// library leaves `图像`. The Host remembers which conversation belongs to which
// project; messages sent from the dock carry the `<image-context>` block.

function library() {
  const state = rendererWorkbenchStore.getState();
  return state.imageLibraryWorkspaceId ? state.workspaces[state.imageLibraryWorkspaceId] : undefined;
}

/** Selects the project's conversation, or a new draft in the library when it has none yet. */
export async function openImageProjectConversation(projectId: string, conversation: { sessionPath: string; sessionFileIdentity: string } | undefined): Promise<void> {
  const workspace = library();
  if (!workspace) return;
  const selected = selectedWorkbenchTask(rendererWorkbenchStore.getState());
  if (conversation) {
    if (selected?.conversation.kind === "session" && selected.conversation.sessionPath === conversation.sessionPath) return;
    await openRendererWorkspaceDescriptor(workspace, conversation.sessionPath, conversation.sessionFileIdentity);
    return;
  }
  if (selected?.workspaceId === workspace.id && selected.conversation.kind === "provisional") return;
  await beginRendererSessionIntentInWorkspace(workspace);
}

/**
 * While a project page is open: attaches the structured context to every prompt
 * sent from a library conversation, and records the conversation once the first
 * message has created its session.
 */
export function bindImageProjectConversation(projectId: string): () => void {
  const releaseContext = setComposerPromptContext(() => {
    const state = rendererWorkbenchStore.getState();
    const task = selectedWorkbenchTask(state);
    const project = useImageProject.getState();
    if (!task || task.workspaceId !== state.imageLibraryWorkspaceId || project.projectId !== projectId || project.revision === undefined) return undefined;
    return formatImagePromptContext({ projectId, revision: project.revision, selectedObjectIds: project.selectedObjectIds, marks: [], references: [] });
  });
  const unsubscribe = rendererWorkbenchStore.subscribe((state) => {
    const task = selectedWorkbenchTask(state);
    const project = useImageProject.getState();
    if (!task || task.workspaceId !== state.imageLibraryWorkspaceId || task.conversation.kind !== "session" || project.projectId !== projectId || project.conversation) return;
    const conversation = { sessionPath: task.conversation.sessionPath, sessionFileIdentity: task.conversation.sessionFileIdentity };
    useImageProject.setState({ conversation });
    void agentConnectionController.request("image.project.conversation.set", { projectId, conversation }, [], { context: { scope: "workspace", workspaceId: task.workspaceId } })
      .catch(() => { useImageProject.setState({ conversation: undefined }); });
  });
  return () => { releaseContext(); unsubscribe(); };
}

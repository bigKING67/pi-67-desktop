import { HostCommandError } from "../protocol-error.js";
import type { HostEventChannel } from "../host-event-channel.js";
import type { WorkspaceContextRegistry } from "../workspace-context-registry.js";
import type { PromptAttachmentAccessOwner } from "../prompt-attachment-access.js";
import { ImageEngineHost } from "./image-engine-host.js";

/**
 * Image projects live inside the Workspace and every command may write there,
 * so the same trust gate as Workspace file access applies.
 */
export function createImageEngineHost(workspaces: WorkspaceContextRegistry, events: HostEventChannel, attachments?: Pick<PromptAttachmentAccessOwner, "readStagedImage">): ImageEngineHost {
  return new ImageEngineHost({
    ...(attachments ? { readStagedImage: (id: string) => attachments.readStagedImage(id) } : {}),
    workspaceRoot: (workspaceId) => {
      const workspace = workspaces.require(workspaceId);
      if (workspace.initialization.trust !== "trusted") throw new HostCommandError("WORKSPACE_NOT_TRUSTED", "Trust this Workspace before opening its image projects.", true);
      return workspace.canonicalCwd;
    },
    emit: (workspaceId, event) => { events.sendFor(event, { runtime: undefined, operations: undefined, context: { scope: "workspace", workspaceId } }); }
  });
}

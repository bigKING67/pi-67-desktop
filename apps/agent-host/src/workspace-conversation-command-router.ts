import type { AgentCommand, CommandResults } from "@pi67/protocol";
import {
  mutateManagedSessionName,
  resolveManagedSessionPath
} from "@pi67/pi-runtime";
import { HostCommandError } from "./protocol-error.js";
import type { SessionWriterLeaseRegistry } from "./session-writer-lease-registry.js";
import type { WorkspaceContextRegistry } from "./workspace-context-registry.js";

export type WorkspaceConversationCommandType =
  | "session.nameByPath"
  | "conversation.pin"
  | "conversation.archive";
export type WorkspaceConversationCommand = AgentCommand<WorkspaceConversationCommandType>;
export type WorkspaceConversationResult = CommandResults[WorkspaceConversationCommandType];

export class WorkspaceConversationCommandRouter {
  constructor(
    private readonly workspaces: WorkspaceContextRegistry,
    private readonly sessionWriterLeases: SessionWriterLeaseRegistry
  ) {}

  async execute(
    workspaceId: string,
    command: WorkspaceConversationCommand,
    idempotencyKey: string
  ): Promise<WorkspaceConversationResult> {
    const workspace = this.workspaces.require(workspaceId);
    const path = await resolveManagedSessionPath(command.payload.path, workspace.cwd, workspace.agentDir)
      .catch((error: unknown) => {
        throw new HostCommandError(
          "INVALID_PAYLOAD",
          error instanceof Error ? error.message : "The Pi Session path is not managed.",
          false
        );
      });
    if (command.type === "session.nameByPath") {
      const lease = await this.sessionWriterLeases.reserve(
        `workspace:${workspaceId}:rename:${idempotencyKey}`,
        path
      );
      try {
        const record = await mutateManagedSessionName({
          path,
          cwd: workspace.cwd,
          agentDir: workspace.agentDir,
          mutation: command.payload.mutation
        });
        await workspace.sessionCatalog.upsertRecord(record, "session-updated");
        return { revision: workspace.sessionCatalog.status().revision };
      } finally {
        await this.sessionWriterLeases.cancel(lease);
      }
    }
    const revision = await workspace.sessionCatalog.organize(
      path,
      command.type === "conversation.pin"
        ? { kind: "pin", value: command.payload.pinned }
        : { kind: "archive", value: command.payload.archived }
    );
    return { revision };
  }
}

export function isWorkspaceConversationCommand(
  type: string
): type is WorkspaceConversationCommandType {
  return type === "session.nameByPath"
    || type === "conversation.pin"
    || type === "conversation.archive";
}

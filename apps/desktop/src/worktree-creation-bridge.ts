import { ipcMain } from "electron";
import {
  isWorktreeCreationAdvanceResult,
  isWorktreeCreationActivityResult,
  isWorktreeCreationCancelResult,
  isWorktreeCreationResult,
  isWorktreeCreationRollbackResult,
  parseWorktreeCreationAdvanceRequest,
  parseWorktreeCreationActivityRequest,
  parseWorktreeCreationCancelRequest,
  parseWorktreeCreationRequest,
  parseWorktreeCreationRollbackRequest,
  type WorktreeCreationAdvanceRequest,
  type WorktreeCreationAdvanceResult,
  type WorktreeCreationActivityRequest,
  type WorktreeCreationActivityResult,
  type WorktreeCreationCancelRequest,
  type WorktreeCreationCancelResult,
  type WorktreeCreationRequest,
  type WorktreeCreationResult,
  type WorktreeCreationRollbackRequest,
  type WorktreeCreationRollbackResult
} from "@pi67/protocol";

export interface WorktreeCreationBridge {
  create(request: WorktreeCreationRequest): Promise<WorktreeCreationResult>;
  activity(request: WorktreeCreationActivityRequest): WorktreeCreationActivityResult | Promise<WorktreeCreationActivityResult>;
  cancel(request: WorktreeCreationCancelRequest): WorktreeCreationCancelResult | Promise<WorktreeCreationCancelResult>;
  advance(request: WorktreeCreationAdvanceRequest): Promise<WorktreeCreationAdvanceResult>;
  rollback(request: WorktreeCreationRollbackRequest): Promise<WorktreeCreationRollbackResult>;
  dispose?(): void;
}

export function registerWorktreeCreationBridge(creation: WorktreeCreationBridge): void {
  ipcMain.handle("pi67:worktree-environment-activity", async (_event, value: unknown) => {
    const request = parseWorktreeCreationActivityRequest(value);
    if (!request) return { status: "inactive" };
    const result = await creation.activity(request);
    return isWorktreeCreationActivityResult(result) ? result : { status: "inactive" };
  });
  ipcMain.handle("pi67:worktree-environment-cancel", async (_event, value: unknown) => {
    const request = parseWorktreeCreationCancelRequest(value);
    if (!request) return { status: "inactive" };
    const result = await creation.cancel(request);
    return isWorktreeCreationCancelResult(result) ? result : { status: "inactive" };
  });
  ipcMain.handle("pi67:worktree-environment-create", async (_event, value: unknown) => {
    const request = parseWorktreeCreationRequest(value);
    if (!request) return rejected("request", "invalid-request", false);
    try {
      const result = await creation.create(request);
      if (isWorktreeCreationResult(result)) return result;
    } catch {
      // The Renderer receives only the bounded public error contract.
    }
    console.error("Worktree creation failed with an invalid internal result.");
    return rejected("state", "internal", true);
  });
  ipcMain.handle("pi67:worktree-environment-advance", async (_event, value: unknown) => {
    const request = parseWorktreeCreationAdvanceRequest(value);
    if (!request) return rejected("request", "invalid-request", false);
    try {
      const result = await creation.advance(request);
      if (isWorktreeCreationAdvanceResult(result)) return result;
    } catch {
      // The Renderer receives only the bounded public error contract.
    }
    console.error("Worktree creation advance failed with an invalid internal result.");
    return rejected("state", "internal", true);
  });
  ipcMain.handle("pi67:worktree-environment-rollback", async (_event, value: unknown) => {
    const request = parseWorktreeCreationRollbackRequest(value);
    if (!request) return rejected("request", "invalid-request", false);
    try {
      const result = await creation.rollback(request);
      if (isWorktreeCreationRollbackResult(result)) return result;
    } catch {
      // The Renderer receives only the bounded public error contract.
    }
    console.error("Worktree creation rollback failed with an invalid internal result.");
    return rejected("state", "internal", true);
  });
}

function rejected(
  stage: "request" | "state",
  code: "invalid-request" | "internal",
  recoverable: boolean
): Extract<WorktreeCreationResult | WorktreeCreationRollbackResult, { status: "rejected" }> {
  return { status: "rejected", error: { stage, code, recoverable } };
}

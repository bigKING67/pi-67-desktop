export interface WorkspaceContentSearchRequestAuthority {
  revision: number;
  hostEpoch: number;
  workspaceId: string;
}

export function isWorkspaceContentSearchRequestCurrent(
  expected: WorkspaceContentSearchRequestAuthority,
  current: {
    revision: number;
    connected: boolean;
    hostEpoch?: number | undefined;
    workspaceId?: string | undefined;
  }
): boolean {
  return current.revision === expected.revision
    && current.connected
    && current.hostEpoch === expected.hostEpoch
    && current.workspaceId === expected.workspaceId;
}

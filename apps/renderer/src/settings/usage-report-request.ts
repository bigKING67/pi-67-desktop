export interface UsageReportRequestAuthority {
  revision: number;
  hostEpoch: number;
  workspaceId: string;
}

export interface CurrentUsageReportAuthority {
  revision: number;
  connected: boolean;
  hostEpoch?: number | undefined;
  workspaceId?: string | undefined;
}

export function isUsageReportRequestCurrent(
  expected: UsageReportRequestAuthority,
  current: CurrentUsageReportAuthority
): boolean {
  return current.revision === expected.revision
    && current.connected
    && current.hostEpoch === expected.hostEpoch
    && current.workspaceId === expected.workspaceId;
}

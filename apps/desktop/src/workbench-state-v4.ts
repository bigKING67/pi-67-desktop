import {
  WORKBENCH_STATE_VERSION,
  parseWorkbenchStateV4,
  parseWorkbenchStateV5,
  plainWorkspaceEnvironmentBindings,
  type WorkbenchStateV5
} from "./workbench-state-contract.js";

export function parseAndMigrateWorkbenchStateV4(value: unknown): WorkbenchStateV5 | undefined {
  const legacy = parseWorkbenchStateV4(value);
  if (!legacy) return undefined;
  return parseWorkbenchStateV5({
    ...legacy,
    version: WORKBENCH_STATE_VERSION,
    workspaceEnvironments: plainWorkspaceEnvironmentBindings(legacy.workspaces),
    environmentMutations: []
  });
}

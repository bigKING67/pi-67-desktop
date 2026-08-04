import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorkbenchStateStore,
  type RuntimeRecoveryRecord,
  type SessionConversationKey
} from "./workbench-state.js";
import type { NativeWorkspaceDescriptor } from "./workspace-identity.js";

const roots: string[] = [];

export async function cleanupWorkbenchStateTestRoots(): Promise<void> {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
}

export async function temporaryWorkbenchStateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-workbench-state-"));
  roots.push(root);
  return root;
}

export function workbenchStateTestStore(userData: string): WorkbenchStateStore {
  return new WorkbenchStateStore(userData, {
    now: () => 1_700_000_000_000,
    createToken: () => "token"
  });
}

export function workbenchDescriptorFixture(
  id: string,
  canonicalPath: string,
  ino = "2"
): NativeWorkspaceDescriptor {
  return {
    id,
    displayName: id,
    identity: { canonicalPath, device: "1", inode: ino, birthtimeNs: "3", assurance: "filesystem" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

export function workbenchRecoveryRecord(
  taskId: string,
  conversation: SessionConversationKey,
  overrides: Partial<Omit<RuntimeRecoveryRecord, "taskId" | "conversation">> = {}
): RuntimeRecoveryRecord {
  return {
    taskId,
    conversation,
    sessionId: `${taskId}-session`,
    taskGeneration: 1,
    sessionGeneration: 2,
    hostInstanceId: "host-instance-1",
    hostEpoch: 1,
    lastKnownLifecycle: "running",
    ...overrides
  };
}

export function legacyWorkbenchTask(
  taskId: string,
  workspaceId: string,
  lastKnownLifecycle: "running" | "idle",
  sessionPath: string
) {
  return {
    taskId,
    workspaceId,
    sessionId: `${taskId}-session`,
    sessionPath,
    visibility: "tab" as const,
    lastKnownLifecycle
  };
}

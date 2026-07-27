export interface SessionImportBootstrapIdentity {
  hostEpoch: number;
  operationId: string;
}

export const SESSION_IMPORT_BOOTSTRAP_GRACE_MS = 100;

interface PendingWatchdog extends SessionImportBootstrapIdentity {
  timer: ReturnType<typeof globalThis.setTimeout>;
}

let pending: PendingWatchdog | undefined;

export function armSessionImportBootstrapWatchdog(
  identity: SessionImportBootstrapIdentity,
  onExpired: () => void
): boolean {
  if (matches(pending, identity)) return false;
  invalidateSessionImportBootstrapWatchdog();
  pending = {
    ...identity,
    timer: globalThis.setTimeout(() => {
      if (!matches(pending, identity)) return;
      pending = undefined;
      onExpired();
    }, SESSION_IMPORT_BOOTSTRAP_GRACE_MS)
  };
  return true;
}

export function cancelSessionImportBootstrapWatchdog(
  identity: SessionImportBootstrapIdentity
): boolean {
  const current = pending;
  if (current === undefined || !matches(current, identity)) return false;
  globalThis.clearTimeout(current.timer);
  pending = undefined;
  return true;
}

export function invalidateSessionImportBootstrapWatchdog(): void {
  if (!pending) return;
  globalThis.clearTimeout(pending.timer);
  pending = undefined;
}

function matches(
  candidate: PendingWatchdog | undefined,
  identity: SessionImportBootstrapIdentity
): boolean {
  return candidate?.hostEpoch === identity.hostEpoch
    && candidate.operationId === identity.operationId;
}

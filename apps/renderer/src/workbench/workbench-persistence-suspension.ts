// Leaf module: callers that temporarily reselect a Task (projection recovery) suspend Workbench
// persistence without importing the controller, which depends on the app store.
let suspensionDepth = 0;
let resumedListener: (() => void) | undefined;

export function suspendRendererWorkbenchPersistence(): () => void {
  suspensionDepth += 1;
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    suspensionDepth = Math.max(0, suspensionDepth - 1);
    if (suspensionDepth === 0) resumedListener?.();
  };
}

export function isRendererWorkbenchPersistenceSuspended(): boolean {
  return suspensionDepth > 0;
}

/** The Workbench controller observes the final resume to persist the settled selection. */
export function onRendererWorkbenchPersistenceResumed(listener: () => void): void {
  resumedListener = listener;
}

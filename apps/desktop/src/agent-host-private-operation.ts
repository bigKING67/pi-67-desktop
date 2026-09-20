import type { UtilityProcess } from "electron";

/** Private parent-port replies must never be forwarded to a replacement Host. */
export function routePrivateHostOperation(
  host: UtilityProcess,
  message: unknown,
  isCurrent: () => boolean,
  brokers: ReadonlyArray<{ operation(message: unknown): Promise<unknown> | undefined }>
): boolean {
  if (!isCurrent()) return false;
  for (const broker of brokers) {
    const operation = broker.operation(message);
    if (!operation) continue;
    void operation.then((result) => {
      if (isCurrent()) host.postMessage(result);
    }).catch(() => {
      // The Host may close its port after the identity check. Results can contain
      // credentials; never include them in logs or forward them to another port.
    });
    return true;
  }
  return false;
}

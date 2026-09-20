/** Private Host-provided connection. Never inferred from config, environment or CLI files. */
export interface ManagedMemoryConnection {
  endpoint: string;
  apiKey: string;
  localProfileId: string;
  account: string;
  user: string;
}

/** Synchronous acceptance distinguishes no managed mode from a failed managed connection. */
export async function resolveManagedMemoryConnection(events: { emit(channel: string, data: unknown): void }) {
  let connection: Promise<ManagedMemoryConnection> | undefined;
  events.emit("pi67:managed-private-memory:connect", {
    accept: (value: Promise<ManagedMemoryConnection>) => { connection = value; }
  });
  if (!connection) return undefined;
  try { return snapshotManagedMemoryConnection(await connection); }
  catch { throw new Error("Managed local memory is unavailable."); }
}

export function snapshotManagedMemoryConnection(value: ManagedMemoryConnection): ManagedMemoryConnection {
  const validEndpoint = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u.exec(value.endpoint);
  if (!validEndpoint || Number(validEndpoint[1]) > 65_535
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value.localProfileId)
    || value.account !== `private-${value.localProfileId}`
    || typeof value.user !== "string" || !value.user || value.user.length > 128 || /[\r\n]/u.test(value.user)
    || typeof value.apiKey !== "string" || !value.apiKey || value.apiKey.length > 4_096 || /[\r\n]/u.test(value.apiKey)) {
    throw new Error("Invalid managed private memory connection.");
  }
  return { endpoint: value.endpoint, apiKey: value.apiKey, localProfileId: value.localProfileId,
    account: value.account, user: value.user };
}

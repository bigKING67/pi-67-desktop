import type { ContextMemoryConfiguration, ContextSessionStatus } from "@pi67/domain";
import type { LocalMemoryConnection } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";
import { OpenVikingClient } from "./openviking-client.js";

/** Host-private transport. Observation never requests startup or legacy credentials. */
export class ManagedMemoryInspection {
  constructor(
    private readonly inspect: () => Promise<LocalMemoryConnection>,
    private readonly session: (workspaceId: string, sessionId: string) => Promise<ContextSessionStatus>
  ) {}

  async client(configuration: ContextMemoryConfiguration, actorPeerId?: string) {
    if (!configuration.enabled || configuration.defaultPrivacyMode === "off") throw unavailable();
    const connection = await this.connection();
    const verify = async () => {
      const current = await this.connection();
      if (current.endpoint !== connection.endpoint || current.apiKey !== connection.apiKey
        || current.localProfileId !== connection.localProfileId || current.account !== connection.account
        || current.user !== connection.user) throw unavailable();
    };
    return new OpenVikingClient({ ...configuration, endpoint: connection.endpoint }, actorPeerId,
      { source: "managed", bearerToken: connection.apiKey, account: connection.account, user: connection.user }, verify);
  }

  async sessionStatus(workspaceId: string, sessionId: string) {
    const connection = await this.connection();
    const result = await this.session(workspaceId, sessionId);
    const current = await this.connection();
    if (current.apiKey !== connection.apiKey || current.endpoint !== connection.endpoint
      || current.localProfileId !== connection.localProfileId || current.account !== connection.account
      || current.user !== connection.user) throw unavailable();
    return result;
  }

  private async connection() {
    try { return await this.inspect(); } catch { throw unavailable(); }
  }
}

function unavailable() { return new HostCommandError("RUNTIME_NOT_READY", "Managed private memory is unavailable.", true); }

import type { AgentPortClient } from "@pi67/protocol";

/** Owns transferred ports until the transport module can take over. */
export class DeferredAgentPort {
  private pending: MessagePort | undefined;

  constructor(private readonly loadClient: () => Promise<typeof AgentPortClient>) {}

  cancel(): void {
    this.pending?.close();
    this.pending = undefined;
  }

  async load(port: MessagePort, onFailure: () => void): Promise<typeof AgentPortClient | undefined> {
    this.cancel();
    this.pending = port;
    try {
      const Client = await this.loadClient();
      if (this.pending !== port) return undefined;
      this.pending = undefined;
      return Client;
    } catch {
      if (this.pending !== port) return undefined;
      this.cancel();
      onFailure();
      return undefined;
    }
  }
}

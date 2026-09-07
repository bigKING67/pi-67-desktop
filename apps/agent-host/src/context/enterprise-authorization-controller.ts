import type { EnterpriseIdentityStatus } from "@pi67/domain";
import type { CommandResults } from "@pi67/protocol";
import type { HostEventChannel } from "../host-event-channel.js";
import { HostCommandError } from "../protocol-error.js";
import { appContextAuthority } from "./context-memory-support.js";
import type { ContextMemoryConfigurationStore } from "./context-memory-configuration.js";
import type { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";

interface PendingEnterpriseAuthorization {
  endpoint: string;
  deviceSecret: string;
  expiresAt: number;
  generation: number;
}

export class EnterpriseAuthorizationController {
  private identity: EnterpriseIdentityStatus = { state: "signed-out" };
  private readonly pendingAuthorizations = new Map<string, PendingEnterpriseAuthorization>();
  private authorizationGeneration = 0;
  private credentialMutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly configuration: ContextMemoryConfigurationStore,
    private readonly events: HostEventChannel,
    private readonly credentials?: EnterpriseCredentialBrokerClient
  ) {}

  shutdown(): void {
    this.authorizationGeneration += 1;
    this.pendingAuthorizations.clear();
    this.credentials?.shutdown();
  }

  currentIdentity(): EnterpriseIdentityStatus {
    const credential = this.credentials?.snapshot().credential;
    if (!credential) return this.identity;
    if (credential.expiresAt <= Date.now()) {
      this.identity = {
        state: "expired",
        accountId: credential.accountId,
        userId: credential.userId,
        ...(credential.displayName === undefined ? {} : { displayName: credential.displayName }),
        expiresAt: credential.expiresAt
      };
      return this.identity;
    }
    this.identity = identityForCredential(credential);
    return this.identity;
  }

  async beginAuthorization(): Promise<CommandResults["enterprise.auth.begin"]> {
    const generation = ++this.authorizationGeneration;
    this.pendingAuthorizations.clear();
    const configuration = await this.configuration.read();
    const endpoint = configuration.enterpriseGatewayEndpoint;
    if (!endpoint) {
      throw new HostCommandError(
        "UNSUPPORTED",
        "Configure the Enterprise Context Gateway endpoint before signing in.",
        true
      );
    }
    if (this.credentials?.snapshot().storage !== "available") {
      throw new HostCommandError(
        "RUNTIME_NOT_READY",
        "System secure storage is unavailable; enterprise sign-in is disabled.",
        true
      );
    }
    const authorization = await new EnterpriseContextGatewayClient(endpoint)
      .startDeviceAuthorization();
    if (generation !== this.authorizationGeneration) {
      throw new HostCommandError("RUNTIME_NOT_READY", "Enterprise authorization was superseded or cancelled.", true);
    }
    this.pendingAuthorizations.set(authorization.authorizationId, {
      generation,
      endpoint,
      deviceSecret: authorization.deviceSecret,
      expiresAt: authorization.expiresAt
    });
    this.identity = { state: "pending", expiresAt: authorization.expiresAt };
    this.emitIdentity();
    return {
      authorizationId: authorization.authorizationId,
      verificationUri: authorization.verificationUri,
      userCode: authorization.userCode,
      expiresAt: authorization.expiresAt,
      intervalSeconds: authorization.intervalSeconds
    };
  }

  async pollAuthorization(
    authorizationId: string
  ): Promise<CommandResults["enterprise.auth.poll"]> {
    const pending = this.pendingAuthorizations.get(authorizationId);
    if (!pending) return this.currentIdentity();
    if (pending.expiresAt <= Date.now()) {
      this.pendingAuthorizations.delete(authorizationId);
      this.identity = { state: "expired", expiresAt: pending.expiresAt };
      this.emitIdentity();
      return this.identity;
    }
    const exchange = await new EnterpriseContextGatewayClient(pending.endpoint)
      .exchangeDeviceAuthorization(authorizationId, pending.deviceSecret);
    const current = () => pending.generation === this.authorizationGeneration
      && this.pendingAuthorizations.get(authorizationId) === pending;
    if (!current()) return this.currentIdentity();
    if (exchange.state === "pending" || !exchange.credential) return this.identity;
    const credential = exchange.credential;
    await this.mutateCredentials(async () => {
      if (!current()) return;
      await this.credentials!.store(credential);
      if (!current()) {
        await this.credentials!.clear();
        return;
      }
      this.pendingAuthorizations.delete(authorizationId);
      this.identity = identityForCredential(credential);
      this.emitIdentity();
    });
    return this.currentIdentity();
  }

  async disconnect(): Promise<EnterpriseIdentityStatus> {
    const generation = ++this.authorizationGeneration;
    this.pendingAuthorizations.clear();
    await this.mutateCredentials(async () => { await this.credentials?.clear(); });
    if (generation === this.authorizationGeneration) {
      this.identity = { state: "signed-out" };
      this.emitIdentity();
    }
    return this.currentIdentity();
  }

  private mutateCredentials(action: () => Promise<void>): Promise<void> {
    const operation = this.credentialMutation.then(action);
    this.credentialMutation = operation.catch(() => undefined);
    return operation;
  }

  private emitIdentity(): void {
    this.events.sendFor({ type: "enterprise.authChanged", payload: this.identity }, appContextAuthority());
  }
}

function identityForCredential(credential: {
  accountId: string;
  userId: string;
  displayName?: string;
  expiresAt: number;
}): EnterpriseIdentityStatus {
  return {
    state: "signed-in",
    accountId: credential.accountId,
    userId: credential.userId,
    ...(credential.displayName === undefined ? {} : { displayName: credential.displayName }),
    expiresAt: credential.expiresAt
  };
}

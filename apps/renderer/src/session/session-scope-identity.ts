import type { ConversationScopeChoice } from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { loadEnterpriseIdentity } from "../context-memory/context-memory-controller.js";

export async function loadConversationScopeIdentity() {
  const identity = await loadEnterpriseIdentity();
  const configuration = await agentConnectionController.request("context.config.get", {}, [], { context: { scope: "app" } });
  return { identity, serviceEndpoint: configuration.enterpriseGatewayEndpoint };
}

export async function assertConversationScopeIdentity(choice: ConversationScopeChoice | undefined): Promise<void> {
  if (choice?.kind !== "team") return;
  const current = await loadConversationScopeIdentity();
  if (current.identity.state !== "signed-in" || current.identity.userId !== choice.userId
    || current.serviceEndpoint !== choice.serviceEndpoint) {
    throw new Error("此草稿的账户或服务已变化。请重新登录原账户，或更换对话归属；原草稿已保留。");
  }
}

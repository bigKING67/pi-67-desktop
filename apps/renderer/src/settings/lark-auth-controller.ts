import type {
  LarkAppConfigurationInput,
  LarkAuthLoginStartResult,
  LarkAuthSnapshot
} from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";

const APP_CONTEXT = { scope: "app" as const };

export async function loadLarkAuthStatus(): Promise<LarkAuthSnapshot> {
  await ensureAgentConnection();
  return agentConnectionController.request(
    "lark.auth.status",
    {},
    [],
    { context: APP_CONTEXT }
  );
}

export async function beginLarkUserLogin(): Promise<LarkAuthLoginStartResult> {
  await ensureAgentConnection();
  return agentConnectionController.request(
    "lark.auth.login.begin",
    {},
    [],
    { context: APP_CONTEXT }
  );
}

export async function saveLarkApplicationConfiguration(
  input: LarkAppConfigurationInput
): Promise<LarkAuthSnapshot> {
  await ensureAgentConnection();
  return agentConnectionController.request(
    "lark.app.configuration.save",
    input,
    [],
    { context: APP_CONTEXT }
  );
}

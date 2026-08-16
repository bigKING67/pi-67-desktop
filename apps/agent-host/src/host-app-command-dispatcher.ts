import type { AgentRuntime } from "@pi67/pi-runtime";
import type {
  AgentCommand,
  AgentCommandType,
  CommandResults
} from "@pi67/protocol";
import type { LarkAuthManagementPort } from "./lark-auth-management.js";
import {
  isAppConfigurationCommand,
  type AppConfigurationCommandType,
  type AppConfigurationCommandRouter
} from "./app-configuration-command-router.js";
import { HostCommandError } from "./protocol-error.js";

export async function dispatchHostAppCommand(
  command: AgentCommand,
  options: {
    appConfiguration: AppConfigurationCommandRouter;
    idempotencyKey?: string;
    larkAuth: LarkAuthManagementPort;
    loadRuntime(): Promise<AgentRuntime>;
    collectDiagnostics(runtime: AgentRuntime): Promise<CommandResults["diagnostics.collect"]>;
  }
): Promise<CommandResults[AgentCommandType]> {
  if (isAppConfigurationCommand(command.type)) {
    return options.appConfiguration.dispatch(
      command as AgentCommand<AppConfigurationCommandType>,
      options.idempotencyKey
    );
  }
  if (command.type === "lark.auth.status") return options.larkAuth.status();
  if (command.type === "lark.auth.login.begin") return options.larkAuth.beginLogin();
  if (command.type === "lark.app.configuration.save") {
    return options.larkAuth.configureApplication(command.payload);
  }
  const runtime = await options.loadRuntime();
  switch (command.type) {
    case "diagnostics.collect":
      return options.collectDiagnostics(runtime);
    case "doctor.run":
      return runtime.runDoctor();
    case "session.catalog.query":
      return runtime.querySessionCatalog(command.payload);
    default:
      throw new HostCommandError(
        "INVALID_PAYLOAD",
        `Command does not support App authority: ${command.type}`,
        false
      );
  }
}

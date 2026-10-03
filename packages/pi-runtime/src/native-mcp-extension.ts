import { join } from "node:path";
import { createMcpExtension, createToolSearchExtension, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { desktopMcpToolExposure, loadDesktopMcpConfig } from "./native-mcp-config.js";
import type { NativeMcpCatalog } from "./native-mcp-catalog.js";
import type { SafetyPolicyState } from "./safety-extension.js";

export function createDesktopNativeMcpExtensions(options: {
  agentDir: string; cwd: string; catalog: NativeMcpCatalog; getSafety: () => SafetyPolicyState;
}): InlineExtension[] {
  return [
    { name: "pi67-native-tool-search", hidden: true, factory: createToolSearchExtension() },
    { name: "pi67-native-mcp", hidden: true, factory: (pi) => {
      options.catalog.clear();
      pi.on("session_shutdown", () => options.catalog.clear());
      return createMcpExtension({
        logPath: join(options.agentDir, "mcp.log"),
        logging: false,
        saveOutput: false,
        allowOAuthLogin: false,
        includeRegisteredServers: false,
        agentDir: options.agentDir,
        getToolExposure: desktopMcpToolExposure,
        loadConfig: () => {
          const config = loadDesktopMcpConfig({
            cwd: options.cwd, agentDir: options.agentDir,
            projectTrusted: options.getSafety().trust === "trusted"
          });
          options.catalog.configure(config.servers);
          return config;
        },
        onToolsChanged: (entry, tools) => options.catalog.replaceTools(entry, tools)
      })(pi);
    } }
  ];
}

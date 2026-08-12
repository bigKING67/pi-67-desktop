import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const WINDOWS_REAL_USER_CONFIGURED_PROVIDER = "openai";

export function resolveWindowsRealUserProfilePaths(root) {
  const agentDir = join(root, "Pi 配置 含空格");
  const lifecycleAgentDir = join(root, "生命周期 Pi 配置 含空格");
  return {
    agentDir,
    environmentDriftAgentDir: join(root, "错误 Pi 配置 空目录"),
    extensionsDirectory: join(agentDir, "extensions"),
    lifecycleAgentDir,
    lifecycleEnvironmentDriftAgentDir: join(root, "生命周期错误 Pi 配置 空目录"),
    lifecycleExtensionsDirectory: join(lifecycleAgentDir, "extensions"),
    lifecycleUserDataDirectory: join(root, "生命周期用户数据 含空格")
  };
}

export async function prepareWindowsRealUserProfile({
  agentDir,
  environmentDriftAgentDir,
  extensionsDirectory,
  lifecycleAgentDir,
  lifecycleEnvironmentDriftAgentDir,
  lifecycleExtensionsDirectory
}) {
  await Promise.all([
    mkdir(extensionsDirectory, { recursive: true }),
    mkdir(environmentDriftAgentDir, { recursive: true }),
    mkdir(lifecycleExtensionsDirectory, { recursive: true }),
    mkdir(lifecycleEnvironmentDriftAgentDir, { recursive: true })
  ]);
  await Promise.all([
    writeConfiguredProfile(agentDir),
    writeConfiguredProfile(lifecycleAgentDir)
  ]);
}

function writeConfiguredProfile(agentDir) {
  return Promise.all([
    writeFile(join(agentDir, "auth.json"), `${JSON.stringify({
      openai: {
        type: "api_key",
        key: "pi67-windows-provider-profile-fixture"
      }
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
    writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
      defaultProvider: "openai",
      defaultModel: "gpt-5"
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  ]);
}

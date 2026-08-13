import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const WINDOWS_REAL_USER_CONFIGURED_PROVIDER = "openai";

export function resolveWindowsRealUserProfilePaths(root) {
  const agentDir = join(root, "Pi 配置 含空格");
  const lifecycleAgentDir = join(root, "生命周期 Pi 配置 含空格");
  const cleanLifecycleAgentDir = join(root, "全新 Pi 配置 含空格");
  return {
    agentDir,
    environmentDriftAgentDir: join(root, "错误 Pi 配置 空目录"),
    extensionsDirectory: join(agentDir, "extensions"),
    lifecycleAgentDir,
    lifecycleEnvironmentDriftAgentDir: join(root, "生命周期错误 Pi 配置 空目录"),
    lifecycleExtensionsDirectory: join(lifecycleAgentDir, "extensions"),
    lifecycleUserDataDirectory: join(root, "生命周期用户数据 含空格"),
    cleanLifecycleAgentDir,
    cleanLifecycleEnvironmentDriftAgentDir: join(root, "全新生命周期错误 Pi 配置 空目录"),
    cleanLifecycleExtensionsDirectory: join(cleanLifecycleAgentDir, "extensions"),
    cleanLifecycleUserDataDirectory: join(root, "全新生命周期用户数据 含空格")
  };
}

export async function prepareWindowsRealUserProfile({
  agentDir,
  environmentDriftAgentDir,
  extensionsDirectory,
  lifecycleAgentDir,
  lifecycleEnvironmentDriftAgentDir,
  lifecycleExtensionsDirectory,
  cleanLifecycleEnvironmentDriftAgentDir
}) {
  await Promise.all([
    mkdir(extensionsDirectory, { recursive: true }),
    mkdir(environmentDriftAgentDir, { recursive: true }),
    mkdir(lifecycleExtensionsDirectory, { recursive: true }),
    mkdir(lifecycleEnvironmentDriftAgentDir, { recursive: true }),
    mkdir(cleanLifecycleEnvironmentDriftAgentDir, { recursive: true })
  ]);
  await Promise.all([
    writeConfiguredProfile(agentDir),
    writeExistingPiProfile(lifecycleAgentDir)
  ]);
}

export async function prepareFreshWindowsRealUserProfile({
  agentDir,
  writeControlledExtension
}) {
  await waitForCleanDesktopProvisioning(agentDir);
  await writeConfiguredProfile(agentDir);
  const extensionsDirectory = join(agentDir, "extensions");
  await mkdir(extensionsDirectory, { recursive: true });
  await writeControlledExtension(join(extensionsDirectory, "installer-lifecycle-fixture.ts"));
}

export async function inspectCleanWindowsRealUserProfile(agentDir) {
  const [state, mcp] = await Promise.all([
    readJson(join(agentDir, "desktop-capabilities", "state.json")),
    readJson(join(agentDir, "mcp.json"))
  ]);
  const managedServers = mcp?.pi67ManagedMcp?.servers;
  const serverNames = Object.keys(managedServers ?? {}).sort();
  if (
    state?.schema !== "pi67.desktop-capability-state.v1"
    || !Array.isArray(state.packages)
    || state.packages.length === 0
    || state.rules !== "installed"
    || !serverNames.includes("tmwd_browser")
    || !serverNames.includes("js-reverse")
  ) throw new Error("Windows clean-profile lane did not receive complete Desktop capabilities.");
  return {
    browser67ManagedServers: serverNames,
    capabilityPackageCount: state.packages.length,
    rules: state.rules
  };
}

export async function snapshotWindowsExistingProfile(agentDir) {
  const files = await collectFiles(agentDir);
  return Object.fromEntries(await Promise.all(files.map(async (relativePath) => [
    relativePath,
    createHash("sha256").update(await readFile(join(agentDir, relativePath))).digest("hex")
  ])));
}

export async function assertWindowsExistingProfilePreserved(agentDir, before) {
  const after = await snapshotWindowsExistingProfile(agentDir);
  const changed = Object.entries(before).flatMap(([relativePath, sha256]) => (
    after[relativePath] === sha256 ? [] : [relativePath]
  ));
  if (changed.length > 0) {
    throw new Error(`Windows existing-pi-profile lane changed user files: ${JSON.stringify(changed.slice(0, 8))}`);
  }
  return { preservedFileCount: Object.keys(before).length };
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

async function writeExistingPiProfile(agentDir) {
  await Promise.all([
    mkdir(join(agentDir, "rules", "user"), { recursive: true }),
    mkdir(join(agentDir, "skills", "user-skill"), { recursive: true }),
    mkdir(join(agentDir, "prompts"), { recursive: true }),
    mkdir(join(agentDir, "themes"), { recursive: true }),
    mkdir(join(agentDir, "sessions", "legacy"), { recursive: true }),
    mkdir(join(agentDir, "desktop-capabilities"), { recursive: true })
  ]);
  await Promise.all([
    writeConfiguredProfile(agentDir),
    writeFile(join(agentDir, "models.json"), "{\"providers\":[]}\n", "utf8"),
    writeFile(join(agentDir, "mcp.json"), `${JSON.stringify({
      mcpServers: {
        tmwd_browser: { command: "user-browser67", args: ["--user-owned"] },
        "js-reverse": { command: "user-js-reverse", args: ["--user-owned"] }
      }
    }, null, 2)}\n`, "utf8"),
    writeFile(join(agentDir, "mcp-cache.json"), "{\"version\":1,\"servers\":{}}\n", "utf8"),
    writeFile(join(agentDir, "AGENTS.md"), "# Existing Pi TUI user instructions\n", "utf8"),
    writeFile(join(agentDir, "rules", "user", "existing.md"), "# Existing user rule\n", "utf8"),
    writeFile(join(agentDir, "skills", "user-skill", "SKILL.md"), "# Existing user skill\n", "utf8"),
    writeFile(join(agentDir, "prompts", "existing.md"), "Existing user prompt.\n", "utf8"),
    writeFile(join(agentDir, "themes", "existing.json"), "{\"name\":\"existing\"}\n", "utf8"),
    writeFile(join(agentDir, "desktop-capabilities", "state.json"), `${JSON.stringify({
      schema: "pi67.desktop-capability-state.v1",
      catalogVersion: "alpha.21-legacy",
      packages: [{
        id: "pi67-core",
        displayName: "Pi-67 Core",
        resourceTypes: ["rule"],
        treeSha256: "a".repeat(64),
        installed: true,
        packageIndex: 0
      }],
      rules: "installed",
      agents: "user-owned",
      preparedAt: 1
    }, null, 2)}\n`, "utf8"),
    writeFile(join(agentDir, "sessions", "legacy", "session.jsonl"), `${JSON.stringify({
      type: "session",
      version: 3,
      id: "existing-pi-tui-session",
      timestamp: "2026-08-01T00:00:00.000Z",
      cwd: "C:\\\\existing-pi-tui-workspace"
    })}\n`, "utf8")
  ]);
}

async function waitForCleanDesktopProvisioning(agentDir, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const ready = await inspectCleanWindowsRealUserProfile(agentDir).then(() => true).catch(() => false);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Windows clean-profile lane did not finish Desktop capability provisioning.");
}

async function collectFiles(root, directory = root) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    if (directory === root && entry.name === "desktop-capabilities") continue;
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error("Windows Profile fixture cannot contain symlinks.");
    if (metadata.isDirectory()) {
      files.push(...await collectFiles(root, path));
    } else if (metadata.isFile()) {
      files.push(path.slice(root.length + 1));
    }
  }
  return files;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

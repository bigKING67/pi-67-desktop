import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const failures = [];

async function read(relativePath) {
  return readFile(resolve(repositoryRoot, relativePath), "utf8");
}

async function exists(relativePath) {
  try {
    await access(resolve(repositoryRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function requireMatch(source, pattern, label) {
  if (!pattern.test(source)) failures.push(label);
}

function requireIncludes(source, value, label) {
  if (!source.includes(value)) failures.push(label);
}

function requireExcludes(source, value, label) {
  if (source.includes(value)) failures.push(label);
}

async function checkAuthority() {
  const [agents, plans, workflow, guide] = await Promise.all([
    read("AGENTS.md"),
    read("PLANS.md"),
    read(".trellis/workflow.md"),
    read(".trellis/spec/guides/trellis-development-workflow.md")
  ]);
  for (const [name, source] of [["AGENTS.md", agents], ["PLANS.md", plans], ["workflow", workflow], ["guide", guide]]) {
    requireMatch(source, /L0/u, `${name} must define L0 routing`);
    requireMatch(source, /L1/u, `${name} must define L1 routing`);
    requireMatch(source, /L2/u, `${name} must define L2 routing`);
    requireMatch(source, /native/i, `${name} must preserve Native-first execution`);
    requireMatch(source, /Channel/u, `${name} must define Channel review`);
    requireMatch(source, /Relay/u, `${name} must define sequential Relay`);
  }
  requireIncludes(agents, "Channel implement worker is allowed only", "AGENTS.md must keep Channel implementation explicit-only");
  requireMatch(
    workflow,
    /execution_mode=channel[^\n]+explicit user request|Channel implementation is explicit-only/iu,
    "workflow must keep Channel implementation explicit-only"
  );
}

async function checkToolchainAndAuthoritativePaths() {
  const [packageJsonSource, version, lockfile] = await Promise.all([
    read("package.json"),
    read(".trellis/.version"),
    read("pnpm-lock.yaml")
  ]);
  const expectedVersion = version.trim();
  const packageJson = JSON.parse(packageJsonSource);
  if (packageJson.devDependencies?.["@mindfoldhq/trellis"] !== expectedVersion) {
    failures.push("package.json must pin @mindfoldhq/trellis to .trellis/.version exactly");
  }
  requireIncludes(
    lockfile,
    `'@mindfoldhq/trellis':\n        specifier: ${expectedVersion}\n        version: ${expectedVersion}`,
    "pnpm-lock.yaml must record the root Trellis dev dependency pinned to .trellis/.version"
  );

  for (const relativePath of [
    ".trellis/spec/guides/workflow-state-contract.md",
    ".claude/hooks/inject-workflow-state.py",
    ".codex/hooks/inject-workflow-state.py",
    ".trellis/scripts/common/task_routing.py"
  ]) {
    if (!(await exists(relativePath))) failures.push(`authoritative Trellis path is missing: ${relativePath}`);
  }

  const lifecycleCopies = [
    ".agents/skills/trellis-meta/references/customize-local/change-task-lifecycle.md",
    ".claude/skills/trellis-meta/references/customize-local/change-task-lifecycle.md",
    ".grok/skills/trellis-meta/references/customize-local/change-task-lifecycle.md"
  ];
  const sources = await Promise.all(lifecycleCopies.map(read));
  if (new Set(sources).size !== 1) failures.push("task-lifecycle reference copies must remain identical");

  const operationalSources = await Promise.all([
    read(".trellis/workflow.md"),
    read(".trellis/scripts/task.py"),
    read(".trellis/scripts/add_session.py"),
    ...lifecycleCopies.map(read)
  ]);
  for (const source of operationalSources) {
    requireExcludes(source, ".trellis/spec/cli/backend/", "operational Trellis references must not use a nonexistent cli spec path");
    requireExcludes(source, ".trellis/scripts/inject-workflow-state.py", "operational Trellis references must name an installed workflow-state parser");
    requireExcludes(source, "test/regression.test.ts", "operational Trellis references must not name a missing regression test");
  }
}

async function checkConfig() {
  const config = await read(".trellis/config.yaml");
  requireMatch(config, /^session_auto_commit:\s*false\s*$/mu, "session_auto_commit must be false");
  requireMatch(config, /^\s*idle_timeout:\s*5m\s*$/mu, "Channel idle_timeout must be 5m");
  requireMatch(config, /^\s*max_live_workers:\s*1\s*$/mu, "Channel max_live_workers must be 1");
  requireMatch(config, /^\s*dispatch_mode:\s*auto\s*$/mu, "Codex native dispatch must be auto");
  requireExcludes(config, "default_package: @pi67/agent-host", "invalid Trellis package key must not return");
  for (const command of [
    "trellis_relay.py ensure --actor lifecycle --json",
    "trellis_relay.py release --actor lifecycle --json",
    "trellis_relay.py close --actor lifecycle --json"
  ]) {
    requireIncludes(config, command, `missing lifecycle hook: ${command}`);
  }
  for (const packageName of ["agent-host", "desktop", "renderer", "domain", "extension-compat", "pi-runtime", "protocol"]) {
    requireMatch(config, new RegExp(`^  ${packageName}:\\s*$`, "mu"), `missing Trellis package key: ${packageName}`);
  }
}

async function checkRelayAndEntrypoints() {
  const relay = await read(".trellis/scripts/trellis_relay.py");
  const relayTest = await read(".trellis/tests/test_trellis_relay.py");
  const piExtension = await read(".pi/extensions/trellis/index.ts");
  for (const value of [
    "pi67.trellis-relay.event.v1",
    "MAX_EVENT_BYTES = 4096",
    "MAX_HANDOFF_BYTES = 16 * 1024",
    'max_live_workers: 1'
  ]) {
    const source = value === "max_live_workers: 1" ? await read(".trellis/config.yaml") : relay;
    requireIncludes(source, value, `missing Relay contract: ${value}`);
  }
  requireExcludes(relay, '"--tag"', "Relay must not use unsupported channel send --tag");
  requireIncludes(relay, 'environment.pop("TRELLIS_CHANNEL_PROJECT", None)', "Relay must ignore an inherited Worker project bucket");
  requireIncludes(relayTest, "test_archived_task_matches_its_pre_archive_channel_reference", "Relay tests must cover archived lifecycle close");
  requireIncludes(relayTest, "explicit_takeover", "Relay tests must cover explicit takeover");
  requireIncludes(relayTest, "test_inherited_worker_project_does_not_misroute_relay_channel", "Relay tests must cover inherited Worker project isolation");
  requireIncludes(relayTest, "test_ephemeral_worker_channel_for_same_task_is_not_a_relay_candidate", "Relay tests must separate Worker and durable Relay channels");
  requireIncludes(piExtension, "export default function trellisExtension", "Pi must load the generated Trellis extension entrypoint");
  requireIncludes(piExtension, 'name: "trellis_subagent"', "Pi must expose the Trellis native sub-agent tool");
  requireIncludes(piExtension, 'pi.on?.("session_start"', "Pi must inject Trellis context at session start");

  const entrypoints = [
    [".agents/skills/trellis-continue/SKILL.md", "codex"],
    [".claude/commands/trellis/continue.md", "claude"],
    [".pi/prompts/trellis-continue.md", "pi"],
    [".grok/commands/trellis-continue.md", "grok"]
  ];
  for (const [relativePath, platform] of entrypoints) {
    const source = await read(relativePath);
    requireIncludes(source, `trellis_relay.py resume --platform ${platform}`, `${relativePath} must use the shared Relay resume`);
    requireIncludes(source, `checkpoint <task`, `${relativePath} must checkpoint before yielding`);
    requireMatch(source, /use `release`|使用 `release`/iu, `${relativePath} must define explicit release`);
    requireMatch(source, /review/iu, `${relativePath} must define independent review mode`);
  }

  for (const root of [
    ".agents/skills/trellis-channel",
    ".claude/skills/trellis-channel",
    ".grok/skills/trellis-channel"
  ]) {
    for (const file of ["references/workers.md", "references/progress-debugging.md", "references/workflows.md"]) {
      const relativePath = `${root}/${file}`;
      requireExcludes(await read(relativePath), "--tag", `${relativePath} must use Trellis 0.6.15 kind filters`);
    }
  }
}

async function checkSpecMaps() {
  const paths = [
    ".trellis/spec/agent-host/backend/index.md",
    ".trellis/spec/agent-host/frontend/index.md",
    ".trellis/spec/desktop/frontend/index.md",
    ".trellis/spec/domain/backend/index.md",
    ".trellis/spec/domain/frontend/index.md",
    ".trellis/spec/extension-compat/backend/index.md",
    ".trellis/spec/extension-compat/frontend/index.md",
    ".trellis/spec/pi-runtime/backend/index.md",
    ".trellis/spec/pi-runtime/frontend/index.md",
    ".trellis/spec/protocol/backend/index.md",
    ".trellis/spec/protocol/frontend/index.md",
    ".trellis/spec/renderer/frontend/index.md"
  ];
  for (const relativePath of paths) {
    const source = await read(relativePath);
    requireExcludes(source, "To fill", `${relativePath} must not advertise placeholder guidance`);
    requireExcludes(source, "To be filled", `${relativePath} must not advertise placeholder guidance`);
    requireMatch(source, /AGENTS\.md/u, `${relativePath} must point to repository authority`);
    requireMatch(source, /^## Pre-Development Checklist$/mu, `${relativePath} must define its loading checklist`);
    requireMatch(source, /^## Quality Check$/mu, `${relativePath} must define its quality gate`);
  }
}

async function checkLocalClaudePermissions() {
  const relativePath = ".claude/settings.local.json";
  if (!(await exists(relativePath))) return;
  let settings;
  try {
    settings = JSON.parse(await read(relativePath));
  } catch {
    failures.push(`${relativePath} must be valid JSON`);
    return;
  }
  if (settings?.permissions?.defaultMode !== "bypassPermissions") {
    failures.push(`${relativePath} must set permissions.defaultMode=bypassPermissions`);
  }
  try {
    execFileSync("git", ["check-ignore", "-q", relativePath], { cwd: repositoryRoot, stdio: "ignore" });
  } catch {
    failures.push(`${relativePath} must remain gitignored`);
  }
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", relativePath], { cwd: repositoryRoot, stdio: "ignore" });
    failures.push(`${relativePath} must not be tracked`);
  } catch {
    // Expected: project-local full-danger is operator state, not repository state.
  }
}

function checkLiveCli() {
  const localCli = resolve(repositoryRoot, "node_modules/.bin/trellis");
  const expectedVersion = readFileSync(resolve(repositoryRoot, ".trellis/.version"), "utf8").trim();
  let version;
  try {
    version = execFileSync(localCli, ["--version"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
  } catch {
    failures.push("repo-local node_modules/.bin/trellis must be installed for --live-cli validation");
    return;
  }
  if (version !== expectedVersion) failures.push(`trellis CLI must be ${expectedVersion}, observed ${version || "empty"}`);
  const sendHelp = execFileSync(localCli, ["channel", "send", "--help"], { cwd: repositoryRoot, encoding: "utf8" });
  const spawnHelp = execFileSync(localCli, ["channel", "spawn", "--help"], { cwd: repositoryRoot, encoding: "utf8" });
  requireIncludes(sendHelp, "--text-file", "trellis channel send must support --text-file");
  requireExcludes(sendHelp, "--tag", "trellis channel send unexpectedly exposes --tag; review Relay contract");
  requireIncludes(spawnHelp, "--sandbox", "trellis channel spawn must support explicit Codex sandbox");
  requireIncludes(spawnHelp, "--max-live-workers", "trellis channel spawn must support one-worker guard");
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((value) => value !== "--live-cli")) {
    throw new Error("Usage: node eng/quality/check-trellis-integration.mjs [--live-cli]");
  }
  await Promise.all([
    checkAuthority(),
    checkConfig(),
    checkRelayAndEntrypoints(),
    checkSpecMaps(),
    checkLocalClaudePermissions(),
    checkToolchainAndAuthoritativePaths()
  ]);
  if (arguments_.includes("--live-cli")) checkLiveCli();
  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`);
    throw new Error(`Trellis integration check failed with ${failures.length} finding(s).`);
  }
  console.log(`Trellis integration check passed (${arguments_.includes("--live-cli") ? "static + live CLI" : "static"}).`);
}

await main();

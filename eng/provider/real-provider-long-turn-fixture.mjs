import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const INHERITED_ENVIRONMENT_KEYS = [
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "LANG",
  "LC_ALL"
];

export async function createIsolatedProviderEnvironment(
  directories,
  inheritedEnvironment = process.env
) {
  const home = join(directories.userDataDirectory, "isolated-home");
  const appData = join(home, "AppData", "Roaming");
  const localAppData = join(home, "AppData", "Local");
  const temporary = join(home, "tmp");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(appData, { recursive: true }),
    mkdir(localAppData, { recursive: true }),
    mkdir(temporary, { recursive: true })
  ]);
  const environment = {
    NODE_ENV: "test",
    PI_CODING_AGENT_DIR: directories.agentDir,
    HOME: home,
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary
  };
  for (const key of INHERITED_ENVIRONMENT_KEYS) {
    const value = inheritedEnvironment[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export async function writeControlledProviderTool({ extensionPath, lifecyclePath, delayMs }) {
  await writeFile(extensionPath, `
    import { appendFileSync } from "node:fs";
    import { Type } from "typebox";

    export default function realProviderLongTurn(pi) {
      pi.registerTool({
        name: "pi67_long_turn_probe",
        label: "Pi-67 long-turn probe",
        description: "Waits for a controlled duration to validate desktop Operation transport semantics.",
        parameters: Type.Object({}),
        async execute() {
          const startedAt = Date.now();
          appendFileSync(${JSON.stringify(lifecyclePath)}, "started:" + startedAt + "\\n");
          await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
          const completedAt = Date.now();
          appendFileSync(${JSON.stringify(lifecyclePath)}, "completed:" + completedAt + "\\n");
          return { content: [{ type: "text", text: "PI67_LONG_TURN_PROBE_COMPLETED" }] };
        }
      });
    }
  `, "utf8");
}

export async function waitForControlledToolLifecycle(path, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const content = await readFile(path, "utf8").catch(() => "");
    if (content.split(/\r?\n/u).some((line) => line.startsWith(`${marker}:`))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Controlled Provider Tool did not emit ${marker} within ${timeoutMs}ms.`);
}

export async function readControlledToolLifecycle(path) {
  const content = await readFile(path, "utf8");
  const lines = content.trim().split(/\r?\n/u);
  if (lines.length !== 2) {
    throw new Error("Controlled Provider Tool must emit exactly one start and one completion marker.");
  }
  const startedAt = parseLifecycleLine(lines[0], "started", "tool.startedAt");
  const completedAt = parseLifecycleLine(lines[1], "completed", "tool.completedAt");
  if (completedAt < startedAt) {
    throw new Error("Controlled Provider Tool lifecycle completed before it started.");
  }
  return { startedAt, completedAt };
}

function parseLifecycleLine(line, expectedLabel, timestampLabel) {
  const separator = line.indexOf(":");
  if (separator < 1 || line.slice(0, separator) !== expectedLabel) {
    throw new Error(`Controlled Provider Tool lifecycle expected ${expectedLabel}.`);
  }
  return requireTimestamp(Number(line.slice(separator + 1)), timestampLabel);
}

function requireTimestamp(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Missing ${label}.`);
  return value;
}

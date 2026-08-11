import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { writeControlledShutdownExtension } from "./controlled-shutdown-fixture.ts";

const execFileAsync = promisify(execFile);

export async function preparePackagedSmokeProfile({
  agentDir,
  extensionsDirectory,
  userDataDirectory,
  workspace
}) {
  const childPidPath = join(userDataDirectory, "child.pid");
  const lifecyclePath = join(userDataDirectory, "lifecycle.txt");
  const packagedCredential = "pi67-packaged-reveal-fixture";
  const packagedExtensionDirectory = join(agentDir, "npm/node_modules/pi67-smoke-extension");
  const nativeReplacedExtensionDirectory = join(agentDir, "npm/node_modules/pi-subagents");
  const packagedSkillDirectory = join(agentDir, "skills/packaged-skill");
  const packagedPromptDirectory = join(agentDir, "prompts");
  await Promise.all([
    mkdir(packagedExtensionDirectory, { recursive: true }),
    mkdir(nativeReplacedExtensionDirectory, { recursive: true }),
    mkdir(packagedSkillDirectory, { recursive: true }),
    mkdir(packagedPromptDirectory, { recursive: true })
  ]);
  await Promise.all([
    writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
      packages: ["npm:pi67-smoke-extension", "npm:pi-subagents"]
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
    writeFile(join(packagedExtensionDirectory, "package.json"), `${JSON.stringify({
      name: "pi67-smoke-extension",
      version: "0.35.1",
      description: "Packaged fixture for Desktop extension and resource projection checks.",
      type: "module",
      pi: { extensions: ["index.js"] }
    }, null, 2)}\n`, "utf8"),
    writeFile(
      join(packagedExtensionDirectory, "index.js"),
      "export default function packagedLocalizationFixture() {}\n",
      "utf8"
    ),
    writeFile(join(nativeReplacedExtensionDirectory, "package.json"), `${JSON.stringify({
      name: "pi-subagents",
      version: "0.35.1",
      description: "Pi extension for delegating tasks to subagents with chains, parallel execution, and TUI clarification",
      type: "module",
      pi: { extensions: ["index.js"] }
    }, null, 2)}\n`, "utf8"),
    writeFile(
      join(nativeReplacedExtensionDirectory, "index.js"),
      "throw new Error('pi-subagents must not load in a Pi-67 Desktop Task');\n",
      "utf8"
    ),
    writeFile(join(packagedSkillDirectory, "SKILL.md"), [
      "---",
      "name: packaged-skill",
      "description: Validates the packaged Skill resource projection.",
      "---",
      "",
      "# Packaged Skill",
      ""
    ].join("\n"), "utf8"),
    writeFile(join(packagedPromptDirectory, "packaged-review.md"), [
      "---",
      "description: Validates the packaged prompt-template resource projection.",
      "---",
      "",
      "Review the packaged Settings resource projection.",
      ""
    ].join("\n"), "utf8"),
    writeFile(join(agentDir, "AGENTS.md"), "Packaged global context fixture.\n", "utf8"),
    writeFile(join(workspace, "AGENTS.md"), "Packaged project context fixture.\n", "utf8")
  ]);
  await writeFile(join(agentDir, "auth.json"), `${JSON.stringify({
    anthropic: { type: "api_key", key: packagedCredential }
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: workspace, encoding: "utf8" });
  await execFileAsync("git", ["add", "AGENTS.md"], { cwd: workspace, encoding: "utf8" });
  await execFileAsync("git", [
    "-c", "user.name=Pi-67",
    "-c", "user.email=pi67@example.invalid",
    "commit", "-m", "packaged smoke fixture"
  ], { cwd: workspace, encoding: "utf8" });
  await writeControlledShutdownExtension({
    extensionPath: join(extensionsDirectory, "shutdown-fixture.ts"),
    childPidPath,
    lifecyclePath
  });

  return { childPidPath, lifecyclePath, packagedCredential };
}

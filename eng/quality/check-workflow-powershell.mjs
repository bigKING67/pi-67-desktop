import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractWorkflowShellRunBodies } from "./workflow-source-security.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const workflowDirectory = join(repositoryRoot, ".github/workflows");
const packagingDirectory = join(repositoryRoot, "eng/packaging");
const workflowFiles = (await readdir(workflowDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
  .map((entry) => entry.name)
  .sort();
const scripts = [];

for (const workflowFile of workflowFiles) {
  const source = await readFile(join(workflowDirectory, workflowFile), "utf8");
  for (const script of extractWorkflowShellRunBodies(source, "pwsh")) {
    scripts.push({ ...script, workflowFile });
  }
}

const packagingScripts = (await readdir(packagingDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".ps1"))
  .map((entry) => entry.name)
  .sort();
for (const scriptFile of packagingScripts) {
  scripts.push({
    body: await readFile(join(packagingDirectory, scriptFile), "utf8"),
    name: scriptFile,
    workflowFile: `eng/packaging/${scriptFile}`
  });
}

if (scripts.length === 0) throw new Error("No PowerShell workflow steps or packaging scripts were discovered.");

if (process.platform !== "win32") {
  console.log(`PowerShell source discovery passed: ${scripts.length} scripts; AST parsing runs on Windows CI.`);
} else {
  await parsePowerShellScripts(scripts);
  console.log(`PowerShell source syntax check passed: ${scripts.length} scripts.`);
}

async function parsePowerShellScripts(values) {
  const directory = await mkdtemp(join(tmpdir(), "pi67-workflow-powershell-"));
  try {
    for (const [index, value] of values.entries()) {
      const path = join(directory, `${String(index + 1).padStart(2, "0")}-${safeName(value.workflowFile)}.ps1`);
      await writeFile(path, `${value.body}\n`, "utf8");
      const result = spawnSync("pwsh", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        POWER_SHELL_PARSE_COMMAND
      ], {
        encoding: "utf8",
        env: { ...process.env, PI67_WORKFLOW_POWERSHELL_PATH: path },
        maxBuffer: 256 * 1024
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        const detail = `${result.stderr || result.stdout}`.trim().slice(0, 4_000);
        throw new Error(
          `Invalid PowerShell in ${value.workflowFile} step ${value.name}: ${detail || "parser failed"}`
        );
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function safeName(value) {
  return basename(value).replace(/[^A-Za-z0-9_.-]+/gu, "-");
}

const POWER_SHELL_PARSE_COMMAND = `
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  $env:PI67_WORKFLOW_POWERSHELL_PATH,
  [ref]$tokens,
  [ref]$errors
) | Out-Null
if ($errors.Count -gt 0) {
  foreach ($parseError in $errors) {
    [Console]::Error.WriteLine(("{0}:{1}:{2}: {3}" -f
      $parseError.Extent.File,
      $parseError.Extent.StartLineNumber,
      $parseError.Extent.StartColumnNumber,
      $parseError.Message
    ))
  }
  exit 1
}
`;

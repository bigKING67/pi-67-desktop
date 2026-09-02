import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const PACK_NAME = "ai-berkshire-investment-suite";
const UPSTREAM = "https://github.com/xbtlin/ai-berkshire";
const SOURCE_ORIGIN = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/?)xbtlin\/ai-berkshire(?:\.git)?\/?$/i;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOL_FILE = /^[A-Za-z0-9_.-]+\.py$/;

export function inspectAiBerkshireSource(source) {
  const skillRoot = path.join(source, "codex-skills");
  const toolsRoot = path.join(source, "tools");
  const licenseFile = path.join(source, "LICENSE");
  if (!fs.existsSync(skillRoot)) throw new Error("source does not contain codex-skills/");
  if (!fs.existsSync(toolsRoot)) throw new Error("source does not contain tools/");
  if (!fs.existsSync(licenseFile)) throw new Error("source does not contain LICENSE");
  if (containsSymlink(skillRoot) || containsSymlink(toolsRoot) || fs.lstatSync(licenseFile).isSymbolicLink()) {
    throw new Error("source Skill or tool inputs must not contain symlinks");
  }

  const commit = runGit(source, ["rev-parse", "--verify", "HEAD"]).trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) {
    throw new Error("source must be a Git checkout with a resolvable full commit");
  }
  const worktree = runGit(source, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (worktree.trim()) throw new Error("source Git worktree must be clean before vendoring a Skill Pack");
  const origin = runGit(source, ["config", "--get", "remote.origin.url"]).trim();
  if (!SOURCE_ORIGIN.test(origin)) throw new Error(`unexpected AI Berkshire origin: ${origin || "missing"}`);

  const skills = fs.readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillRoot, entry.name, "SKILL.md")))
    .map((entry) => inspectSkill(skillRoot, toolsRoot, entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (skills.length === 0) throw new Error("source has no codex-skills/*/SKILL.md packages");
  return { source, skillRoot, toolsRoot, licenseFile, commit, origin, skills };
}

export function buildAiBerkshireBundles(source, output, sourceManifestFile) {
  fs.mkdirSync(output, { recursive: true });
  const sourceFiles = new Map();
  sourceFiles.set("LICENSE", sha256File(source.licenseFile));
  for (const skill of source.skills) {
    const destination = path.join(output, skill.name);
    const scriptsDir = path.join(destination, "scripts");
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "SKILL.md"), adaptSkill(skill, source.commit), "utf8");
    fs.copyFileSync(source.licenseFile, path.join(destination, "LICENSE"));
    sourceFiles.set(`codex-skills/${skill.name}/SKILL.md`, sha256File(skill.sourceFile));
    for (const tool of skill.tools) {
      fs.mkdirSync(scriptsDir, { recursive: true });
      const sourceTool = path.join(source.toolsRoot, tool);
      const destinationTool = path.join(scriptsDir, tool);
      fs.writeFileSync(destinationTool, adaptTool(fs.readFileSync(sourceTool, "utf8")), "utf8");
      fs.chmodSync(destinationTool, 0o755);
      sourceFiles.set(`tools/${tool}`, sha256File(sourceTool));
    }
    fs.writeFileSync(
      path.join(destination, "UPSTREAM.json"),
      `${JSON.stringify({
        schema: "pi67.ai-berkshire-skill-provenance.v1",
        repository: UPSTREAM,
        source_commit: source.commit,
        source_path: `codex-skills/${skill.name}/SKILL.md`,
        pack: PACK_NAME,
      }, null, 2)}\n`,
      "utf8",
    );
  }
  const manifest = {
    schema: "pi67.ai-berkshire-source-manifest.v1",
    repository: UPSTREAM,
    source_commit: source.commit,
    skills: source.skills.map((skill) => skill.name),
    files: [...sourceFiles.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, sha256]) => ({ file, sha256 })),
  };
  fs.writeFileSync(sourceManifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function validateAiBerkshireBundles(buildRoot, skills) {
  const expected = skills.map((skill) => skill.name).sort(compareCodePoints);
  const actual = fs.readdirSync(buildRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`built bundle set mismatch: ${actual.join(", ")}`);
  }
  for (const name of expected) {
    const dir = path.join(buildRoot, name);
    const text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
    const parsed = splitSkill(text);
    if (frontmatterValue(parsed.frontmatter, "name") !== name) throw new Error(`built Skill frontmatter mismatch: ${name}`);
    if (!frontmatterValue(parsed.frontmatter, "description")) throw new Error(`built Skill description is missing: ${name}`);
    if (!text.includes("## Shared Pi/Codex adapter note")) throw new Error(`built Skill adapter is missing: ${name}`);
    if (/tools\/[A-Za-z0-9_.-]+\.py\b/.test(text)) throw new Error(`built Skill has an unresolved tool path: ${name}`);
    if (/skills\/[a-z0-9-]+\.md\b/.test(text)) throw new Error(`built Skill has an unresolved sibling path: ${name}`);
    if (!fs.existsSync(path.join(dir, "LICENSE")) || !fs.existsSync(path.join(dir, "UPSTREAM.json"))) {
      throw new Error(`built Skill provenance is incomplete: ${name}`);
    }
    if (containsSymlink(dir)) throw new Error(`built Skill contains a symlink: ${name}`);
  }
}

function inspectSkill(skillRoot, toolsRoot, directoryName) {
  if (!SKILL_NAME.test(directoryName)) throw new Error(`invalid Skill directory name: ${directoryName}`);
  const sourceFile = path.join(skillRoot, directoryName, "SKILL.md");
  const sourceText = fs.readFileSync(sourceFile, "utf8");
  const parsed = splitSkill(sourceText);
  if (frontmatterValue(parsed.frontmatter, "name") !== directoryName) {
    throw new Error(`Skill frontmatter name mismatch: ${directoryName}`);
  }
  if (!frontmatterValue(parsed.frontmatter, "description")) {
    throw new Error(`Skill is missing a description: ${directoryName}`);
  }

  const tools = new Set();
  for (const match of sourceText.matchAll(/tools\/([A-Za-z0-9_.-]+\.py)\b/g)) tools.add(match[1]);
  const availableTools = fs.readdirSync(toolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && TOOL_FILE.test(entry.name))
    .map((entry) => entry.name);
  for (const tool of availableTools) {
    if (new RegExp(`(^|[^A-Za-z0-9_./])${escapeRegExp(tool)}\\b`, "m").test(sourceText)) tools.add(tool);
  }
  for (const tool of tools) {
    const toolPath = path.join(toolsRoot, tool);
    if (!TOOL_FILE.test(tool) || !fs.existsSync(toolPath) || !fs.statSync(toolPath).isFile()) {
      throw new Error(`Skill ${directoryName} references a missing or invalid tool: ${tool}`);
    }
    if (fs.statSync(toolPath).size > 1024 * 1024) throw new Error(`Skill tool exceeds 1 MiB: ${tool}`);
  }
  return {
    name: directoryName,
    sourceFile,
    sourceText,
    tools: [...tools].sort(compareCodePoints),
  };
}

function adaptTool(sourceText) {
  return sourceText.replace(/tools\/([A-Za-z0-9_.-]+\.py)\b/g, "scripts/$1");
}

function adaptSkill(skill, sourceCommit) {
  const parsed = splitSkill(skill.sourceText);
  let frontmatter = parsed.frontmatter.replace(
    /Source:\s*skills\/([a-z0-9-]+)\.md\.?/g,
    "Upstream workflow: $1.",
  );
  if (!/^license:\s*/m.test(frontmatter)) frontmatter = `${frontmatter.trimEnd()}\nlicense: MIT (see LICENSE)`;
  if (skill.name === "investment-memo-craft") {
    frontmatter = frontmatter.replace(
      /description:\s*(.*Codex-only.*)$/m,
      (_match, value) => `description: ${value.replace(/Codex-only/g, "Shared Pi/Codex").replace(/whenever Codex/g, "whenever Pi or Codex")}`,
    );
  }

  let body = parsed.body.replace(/^## Codex adapter note\s*\n[\s\S]*?(?=^#\s)/m, "");
  body = body.replace(/`skills\/([a-z0-9-]+)\.md`/g, "`$1` Skill");
  body = body.replace(/skills\/([a-z0-9-]+)\.md/g, "$1 Skill");
  body = body.replace(/tools\/([A-Za-z0-9_.-]+\.py)\b/g, "scripts/$1");
  for (const tool of skill.tools) {
    body = body.replace(new RegExp(`(^|[^A-Za-z0-9_./])${escapeRegExp(tool)}\\b`, "gm"), `$1scripts/${tool}`);
  }
  if (skill.name === "investment-memo-craft") {
    body = body
      .replace(/Codex-only/g, "shared Pi/Codex")
      .replace(/decision-ready Codex research report/g, "decision-ready Pi/Codex research report")
      .replace(/when Codex creates/g, "when Pi or Codex creates");
  }
  if (/\/Users\/[A-Za-z0-9._-]+\//.test(body) || /~\/ai-berkshire\b/.test(body) || /[A-Za-z]:\\Users\\[^<]/.test(body)) {
    throw new Error(`adapted Skill contains a personal absolute path: ${skill.name}`);
  }

  const adapter = `## Shared Pi/Codex adapter note

This Skill is distributed by Pi-67 Desktop from AI Berkshire commit \`${sourceCommit}\`.

- Treat \`$ARGUMENTS\` as the user's request in the current agent thread.
- Map Claude-only surfaces such as Task, Agent, TeamCreate, TaskCreate, SendMessage, WebSearch, Bash, Read, or Write to capabilities that are actually present in the live host. Never claim a subagent, search, or tool call ran unless it did.
- Team workflows require real delegation authorization and live subagent support. Otherwise complete the perspectives serially and label the execution as degraded.
- Use current Web search/fetch tools for fresh public information. Do not inspect or require Claude permission files; if live search is unavailable, disclose the cutoff and confidence reduction.
- Tool commands below are Skill-relative. Resolve the directory containing this \`SKILL.md\`, change to that directory, and run bundled paths such as \`python3 scripts/financial_rigor.py ...\` (or the platform's equivalent Python 3 launcher).
- References to another AI Berkshire workflow mean the installed sibling Skill of that name.
- Run \`date\` before time-sensitive research, record the data cutoff, cross-check decision-critical figures, use exact arithmetic, and keep source gaps visible.

`;
  return `---\n${frontmatter.trim()}\n---\n\n${adapter}${body.trimStart().trimEnd()}\n`;
}

function splitSkill(text) {
  if (!text.startsWith("---\n")) throw new Error("Skill is missing YAML frontmatter");
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("Skill has unterminated YAML frontmatter");
  return { frontmatter: text.slice(4, end), body: text.slice(end + 5).replace(/^\s+/, "") };
}

function frontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+?)\\s*$`, "m"));
  return match ? match[1].trim().replace(/^(["'])(.*)\1$/, "$2") : "";
}

function containsSymlink(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) return true;
    if (entry.isDirectory() && containsSymlink(full)) return true;
  }
  return false;
}

function runGit(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr || "").trim()}`);
  return String(result.stdout || "");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, unlink } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  RuntimeError,
  MAX_CONTEXT_FILE_BYTES,
  type ContextFileCatalogResult,
  type ContextFileReadResult,
  type ContextFileSaveResult,
  type ContextFileSummary
} from "@pi67/domain";
import {
  createPrivateFileAtomically,
  withConfigurationFileLock,
  writePrivateFileAtomically
} from "./atomic-private-file.js";
import type { PiWorkspaceRuntimeServices } from "./workspace-runtime-services.js";

export interface ContextFileSaveTransaction {
  readonly result: ContextFileSaveResult;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface ContextFileManagementPort {
  list(): Promise<ContextFileCatalogResult>;
  read(id: string): Promise<ContextFileReadResult>;
  mutationScope(id: string): Promise<"global" | "project">;
  beginSave(id: string, expectedRevision: string, content: string): Promise<ContextFileSaveTransaction>;
}

interface CatalogEntry {
  item: ContextFileSummary;
  targetPath: string;
}

interface FileState {
  presence: "present" | "missing";
  content?: string;
  revision: string;
}

const CONTEXT_NAMES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"] as const;
const MANAGED_RULE_LIMIT = 480;
const CATALOG_VERSION = "context-file-v1";

export function createContextFileManagement(
  services: PiWorkspaceRuntimeServices
): ContextFileManagementPort {
  return new ContextFileManagement(services);
}

class ContextFileManagement implements ContextFileManagementPort {
  constructor(private readonly services: PiWorkspaceRuntimeServices) {}

  async list(): Promise<ContextFileCatalogResult> {
    const entries = await this.catalog();
    return {
      items: entries.map((entry) => entry.item),
      workspaceTrusted: this.services.settingsManager.isProjectTrusted()
    };
  }

  async read(id: string): Promise<ContextFileReadResult> {
    const entry = await this.requireEntry(id);
    if (entry.item.presence === "missing") {
      if (entry.item.access !== "creatable") this.throwReadOnly(entry.item);
      return { item: entry.item, content: "", revision: missingRevisionForPath(entry.targetPath) };
    }
    const state = await readFileState(entry.targetPath);
    if (state.presence !== "present" || state.content === undefined) {
      throw changedExternally("The context file changed before it could be read.");
    }
    return { item: entry.item, content: state.content, revision: state.revision };
  }

  async mutationScope(id: string): Promise<"global" | "project"> {
    const entry = await this.requireWritableEntry(id);
    return entry.item.scope === "global" ? "global" : "project";
  }

  async beginSave(
    id: string,
    expectedRevision: string,
    content: string
  ): Promise<ContextFileSaveTransaction> {
    assertContentSize(content);
    const initial = await this.requireWritableEntry(id);
    const root = initial.item.scope === "global" ? this.services.agentDir : this.services.cwd;
    await assertSafeWritablePath(initial.targetPath, root);

    const before = await withConfigurationFileLock(initial.targetPath, async () => {
      const entry = await this.requireWritableEntry(id);
      await assertSafeWritablePath(entry.targetPath, root);
      const current = await readFileState(entry.targetPath);
      if (current.revision !== expectedRevision) {
        throw changedExternally("The context file was modified outside Pi-67 Desktop.");
      }
      if (current.presence === "present") {
        await writePrivateFileAtomically(entry.targetPath, content);
      } else {
        try {
          await createPrivateFileAtomically(entry.targetPath, content);
        } catch (error) {
          if (isNodeError(error, "EEXIST")) {
            throw changedExternally("The context file was created outside Pi-67 Desktop.");
          }
          throw error;
        }
      }
      return { entry, current };
    });

    const writtenRevision = presentRevision(Buffer.from(content, "utf8"));
    const files = await this.list();
    const savedItem = files.items.find((item) => item.id === id);
    if (!savedItem) {
      await this.restore(before.entry, before.current, writtenRevision);
      throw new RuntimeError("RESOURCE_NOT_FOUND", "The saved context file is no longer in the allowed catalog.");
    }
    let settled = false;
    return {
      result: { item: savedItem, revision: writtenRevision, files },
      commit: async () => { settled = true; },
      rollback: async () => {
        if (settled) return;
        await this.restore(before.entry, before.current, writtenRevision);
        settled = true;
      }
    };
  }

  private async restore(entry: CatalogEntry, before: FileState, writtenRevision: string): Promise<void> {
    await withConfigurationFileLock(entry.targetPath, async () => {
      const current = await readFileState(entry.targetPath);
      if (current.revision !== writtenRevision) {
        throw changedExternally("The context file changed again while Pi resources were reloading.");
      }
      if (before.presence === "present" && before.content !== undefined) {
        await writePrivateFileAtomically(entry.targetPath, before.content);
      } else {
        await unlink(entry.targetPath);
      }
    });
  }

  private async requireEntry(id: string): Promise<CatalogEntry> {
    const entry = (await this.catalog()).find((candidate) => candidate.item.id === id);
    if (!entry) {
      throw new RuntimeError("RESOURCE_NOT_FOUND", "The context file is not in the current allowed catalog.");
    }
    return entry;
  }

  private async requireWritableEntry(id: string): Promise<CatalogEntry> {
    const entry = await this.requireEntry(id);
    if (entry.item.access === "editable" || entry.item.access === "creatable") return entry;
    this.throwReadOnly(entry.item);
  }

  private throwReadOnly(item: ContextFileSummary): never {
    if (item.origin === "workspace" && !this.services.settingsManager.isProjectTrusted()) {
      throw new RuntimeError("WORKSPACE_NOT_TRUSTED", "Trust this Workspace before changing its context files.");
    }
    throw new RuntimeError(
      "PATH_OUTSIDE_WORKSPACE",
      "This context file is read-only in Pi-67 Desktop.",
      { recoverable: false }
    );
  }

  private async catalog(): Promise<CatalogEntry[]> {
    const trusted = this.services.settingsManager.isProjectTrusted();
    const entries: CatalogEntry[] = [];
    entries.push(...await managedRuleEntries(join(this.services.agentDir, "rules", "pi67-desktop")));
    entries.push(...await contextDirectoryEntries({
      directory: this.services.agentDir,
      scope: "global",
      origin: "user",
      trusted: true,
      allowCreate: true
    }));
    entries.push(...await systemPromptEntries(this.services, trusted));
    entries.push(...await contextDirectoryEntries({
      directory: this.services.cwd,
      scope: "project",
      origin: "workspace",
      trusted,
      allowCreate: trusted
    }));
    entries.push(...await inheritedContextEntries(this.services.cwd, trusted));
    if (entries.length > 512) {
      throw new RuntimeError("RESOURCE_LIMIT_EXCEEDED", "The context file catalog exceeds its safe item limit.");
    }
    return dedupeEntries(entries);
  }
}

async function managedRuleEntries(root: string): Promise<CatalogEntry[]> {
  const paths: string[] = [];
  await collectManagedRules(root, paths);
  paths.sort((left, right) => left.localeCompare(right));
  return paths.map((path) => entryFor(path, {
    category: "managed-rule",
    scope: "managed",
    origin: "desktop",
    presence: "present",
    access: "read-only",
    runtimeState: "active",
    detail: "随 Desktop 更新，只读"
  }));
}

async function collectManagedRules(directory: string, paths: string[]): Promise<void> {
  let children;
  try {
    children = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
  for (const child of children) {
    if (paths.length >= MANAGED_RULE_LIMIT) {
      throw new RuntimeError("RESOURCE_LIMIT_EXCEEDED", "The managed rule catalog exceeds its safe item limit.");
    }
    const path = join(directory, child.name);
    if (child.isDirectory()) await collectManagedRules(path, paths);
    else if (child.isFile() && child.name.toLowerCase().endsWith(".md")) paths.push(path);
  }
}

async function contextDirectoryEntries(options: {
  directory: string;
  scope: "global" | "project";
  origin: "user" | "workspace";
  trusted: boolean;
  allowCreate: boolean;
}): Promise<CatalogEntry[]> {
  const existing: Array<{ path: string; regular: boolean }> = [];
  const seenFileIdentities = new Set<string>();
  for (const name of CONTEXT_NAMES) {
    const path = join(options.directory, name);
    const stats = await safeLstat(path);
    if (!stats) continue;
    const identity = stats.ino > 0 ? `${stats.dev}:${stats.ino}` : undefined;
    if (identity && seenFileIdentities.has(identity)) continue;
    if (identity) seenFileIdentities.add(identity);
    existing.push({ path, regular: stats.isFile() && !stats.isSymbolicLink() });
  }
  const winner = existing[0]?.path;
  const entries = existing.map(({ path, regular }) => entryFor(path, {
    category: "rules-context",
    scope: options.scope,
    origin: options.origin,
    presence: "present",
    access: regular && options.allowCreate ? "editable" : "read-only",
    runtimeState: !regular || !options.trusted
      ? "unavailable"
      : path === winner ? "active" : "overridden",
    ...(!regular ? { detail: "仅支持普通 Markdown 文件" } : {})
  }));
  const canonicalAgentsPath = join(options.directory, "AGENTS.md");
  if (!existing.some(({ path }) => path === canonicalAgentsPath)) {
    entries.push(entryFor(canonicalAgentsPath, {
      category: "rules-context",
      scope: options.scope,
      origin: options.origin,
      presence: "missing",
      access: options.allowCreate ? "creatable" : "read-only",
      runtimeState: options.trusted ? "not-loaded" : "unavailable",
      detail: options.allowCreate ? "可新建标准 AGENTS.md" : "信任项目后可新建"
    }));
  }
  return entries;
}

async function inheritedContextEntries(cwd: string, trusted: boolean): Promise<CatalogEntry[]> {
  const entries: CatalogEntry[] = [];
  let directory = dirname(cwd);
  while (true) {
    for (const name of CONTEXT_NAMES) {
      const path = join(directory, name);
      const stats = await safeLstat(path);
      if (!stats) continue;
      entries.unshift(entryFor(path, {
        category: "rules-context",
        scope: "inherited",
        origin: "ancestor",
        presence: "present",
        access: "read-only",
        runtimeState: stats.isFile() && !stats.isSymbolicLink() && trusted ? "active" : "unavailable",
        detail: "来自 Workspace 外父目录，只读"
      }));
      break;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return entries;
}

async function systemPromptEntries(
  services: PiWorkspaceRuntimeServices,
  trusted: boolean
): Promise<CatalogEntry[]> {
  const results: CatalogEntry[] = [];
  for (const [name, category] of [
    ["SYSTEM.md", "system-prompt"],
    ["APPEND_SYSTEM.md", "append-system-prompt"]
  ] as const) {
    const globalPath = join(services.agentDir, name);
    const projectPath = join(services.cwd, ".pi", name);
    const globalStats = await safeLstat(globalPath);
    const projectStats = await safeLstat(projectPath);
    const projectActive = trusted && projectStats?.isFile() === true && !projectStats.isSymbolicLink();
    results.push(entryFor(globalPath, {
      category,
      scope: "global",
      origin: "user",
      presence: globalStats ? "present" : "missing",
      access: globalStats ? globalStats.isFile() && !globalStats.isSymbolicLink() ? "editable" : "read-only" : "creatable",
      runtimeState: globalStats
        ? projectActive ? "overridden" : globalStats.isFile() && !globalStats.isSymbolicLink() ? "active" : "unavailable"
        : "not-loaded",
      detail: category === "system-prompt" ? "替换默认系统提示词" : "追加系统提示词"
    }));
    results.push(entryFor(projectPath, {
      category,
      scope: "project",
      origin: "workspace",
      presence: projectStats ? "present" : "missing",
      access: projectStats
        ? projectStats.isFile() && !projectStats.isSymbolicLink() && trusted ? "editable" : "read-only"
        : trusted ? "creatable" : "read-only",
      runtimeState: !trusted
        ? "unavailable"
        : projectStats ? projectActive ? "active" : "unavailable" : "not-loaded",
      detail: !trusted
        ? "信任项目后可管理"
        : category === "system-prompt" ? "存在时覆盖全局 SYSTEM.md" : "存在时覆盖全局 APPEND_SYSTEM.md"
    }));
  }
  return results;
}

function entryFor(
  path: string,
  fields: Omit<ContextFileSummary, "id" | "name" | "path">
): CatalogEntry {
  const normalizedPath = resolve(path);
  const id = `ctx_${createHash("sha256")
    .update(CATALOG_VERSION, "utf8")
    .update("\0")
    .update(fields.category, "utf8")
    .update("\0")
    .update(fields.scope, "utf8")
    .update("\0")
    .update(normalizedPath, "utf8")
    .digest("hex")}`;
  return {
    item: { id, name: basename(normalizedPath), path: normalizedPath, ...fields },
    targetPath: normalizedPath
  };
}

function dedupeEntries(entries: CatalogEntry[]): CatalogEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.item.id)) return false;
    seen.add(entry.item.id);
    return true;
  });
}

async function readFileState(path: string): Promise<FileState> {
  const stats = await safeLstat(path);
  if (!stats) return { presence: "missing", revision: missingRevisionForPath(path) };
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new RuntimeError("PATH_OUTSIDE_WORKSPACE", "Only regular Markdown files can be managed.", {
      recoverable: false
    });
  }
  if (stats.size > MAX_CONTEXT_FILE_BYTES) {
    throw new RuntimeError("RESOURCE_LIMIT_EXCEEDED", "The Markdown file exceeds the 1,000,000-byte limit.");
  }
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_CONTEXT_FILE_BYTES) {
    throw new RuntimeError("RESOURCE_LIMIT_EXCEEDED", "The Markdown file exceeds the 1,000,000-byte limit.");
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RuntimeError("INVALID_PAYLOAD", "The Markdown file is not valid UTF-8.", { recoverable: false });
  }
  return { presence: "present", content, revision: presentRevision(bytes) };
}

function assertContentSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_CONTEXT_FILE_BYTES) {
    throw new RuntimeError("RESOURCE_LIMIT_EXCEEDED", "The Markdown content exceeds the 1,000,000-byte limit.");
  }
}

async function assertSafeWritablePath(path: string, root: string): Promise<void> {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  const relation = relative(normalizedRoot, normalizedPath);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`) || relation.startsWith(sep)) {
    throw new RuntimeError("PATH_OUTSIDE_WORKSPACE", "The context file is outside its allowed root.", {
      recoverable: false
    });
  }
  const segments = relative(normalizedRoot, dirname(normalizedPath)).split(sep).filter(Boolean);
  let current = normalizedRoot;
  for (const segment of segments) {
    current = join(current, segment);
    const stats = await safeLstat(current);
    if (!stats) break;
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new RuntimeError("PATH_OUTSIDE_WORKSPACE", "A context file parent is not a safe directory.", {
        recoverable: false
      });
    }
  }
}

function presentRevision(bytes: Uint8Array): string {
  return createHash("sha256").update("present\0", "utf8").update(bytes).digest("hex");
}

function missingRevisionForPath(path: string): string {
  return createHash("sha256").update("missing-path\0", "utf8").update(resolve(path), "utf8").digest("hex");
}

function changedExternally(message: string): RuntimeError {
  return new RuntimeError("RESOURCE_CHANGED_EXTERNALLY", message, { recoverable: true });
}

async function safeLstat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

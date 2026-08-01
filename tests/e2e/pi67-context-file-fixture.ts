import type { ContextFileSummary } from "../../packages/domain/src/index.js";
import type {
  FixtureAgentState,
  FixtureContextFiles,
  FixtureWindow
} from "./pi67-renderer-fixture-types.js";

export type MockContextFileCommandHandler = (
  type: string,
  payload: Record<string, unknown>,
  state: FixtureAgentState
) => unknown;

export function installMockContextFileCommandHandler(): void {
  (window as FixtureWindow & {
    __pi67ResolveMockContextFileCommand?: MockContextFileCommandHandler;
  }).__pi67ResolveMockContextFileCommand = (type, payload, current) => {
    if (type === "context.file.list") return current.contextFiles.catalog;
    if (type === "context.file.read") {
      const id = String(payload.id);
      const item = current.contextFiles.catalog.items.find((candidate) => candidate.id === id);
      const stored = current.contextFiles.contents[id];
      if (!item || !stored) throw new Error(`Unknown context file fixture: ${id}`);
      return { item, content: stored.content, revision: stored.revision };
    }
    if (type !== "context.file.save") return undefined;
    const id = String(payload.id);
    if (typeof payload.content !== "string") {
      throw new Error("Context file fixture requires string content.");
    }
    const content = payload.content;
    const index = current.contextFiles.catalog.items.findIndex((candidate) => candidate.id === id);
    const stored = current.contextFiles.contents[id];
    if (index < 0 || !stored) throw new Error(`Unknown context file fixture: ${id}`);
    if (payload.expectedRevision !== stored.revision) {
      throw new Error("Context file fixture received a stale revision.");
    }
    const item = current.contextFiles.catalog.items[index]!;
    const savedItem = item.presence === "missing"
      ? { ...item, presence: "present" as const, access: "editable" as const, runtimeState: "active" as const }
      : item;
    const revision = contentRevision(content);
    current.contextFiles.contents[id] = { content, revision };
    current.contextFiles.catalog = {
      ...current.contextFiles.catalog,
      items: current.contextFiles.catalog.items.map((candidate, candidateIndex) => (
        candidateIndex === index ? savedItem : candidate
      ))
    };
    return { item: savedItem, revision, files: current.contextFiles.catalog };
  };

  function contentRevision(content: string): string {
    let hash = 2_166_136_261;
    for (const byte of new TextEncoder().encode(content)) {
      hash ^= byte;
      hash = Math.imul(hash, 16_777_619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0").repeat(8);
  }
}

export function createMockContextFiles(): FixtureContextFiles {
  const managedNames = [
    "00-product.md",
    "10-security.md",
    "20-architecture.md",
    "30-runtime.md",
    "40-protocol.md",
    "50-renderer.md",
    "60-design.md",
    "70-performance.md",
    "80-testing.md",
    "90-packaging.md",
    "99-release.md"
  ];
  const managed = managedNames.map((name, index): ContextFileSummary => ({
    id: contextId(index + 1),
    name,
    path: `/Applications/Pi-67.app/Contents/Resources/rules/pi67-desktop/${name}`,
    category: "managed-rule",
    scope: "managed",
    origin: "desktop",
    presence: "present",
    access: "read-only",
    runtimeState: "active",
    detail: "随 Desktop 更新，只读"
  }));
  const globalAgents = contextItem(20, {
    name: "AGENTS.md",
    path: "/Users/test/.pi/agent/AGENTS.md",
    category: "rules-context",
    scope: "global",
    origin: "user",
    presence: "present",
    access: "editable",
    runtimeState: "active"
  });
  const globalSystem = contextItem(21, {
    name: "SYSTEM.md",
    path: "/Users/test/.pi/agent/SYSTEM.md",
    category: "system-prompt",
    scope: "global",
    origin: "user",
    presence: "missing",
    access: "creatable",
    runtimeState: "not-loaded",
    detail: "替换默认系统提示词"
  });
  const globalAppend = contextItem(22, {
    name: "APPEND_SYSTEM.md",
    path: "/Users/test/.pi/agent/APPEND_SYSTEM.md",
    category: "append-system-prompt",
    scope: "global",
    origin: "user",
    presence: "missing",
    access: "creatable",
    runtimeState: "not-loaded",
    detail: "追加系统提示词"
  });
  const projectAgents = contextItem(23, {
    name: "AGENTS.md",
    path: "/Users/test/Projects/pi-demo/AGENTS.md",
    category: "rules-context",
    scope: "project",
    origin: "workspace",
    presence: "present",
    access: "editable",
    runtimeState: "active"
  });
  const inheritedAgents = contextItem(24, {
    name: "AGENTS.md",
    path: "/Users/test/Projects/AGENTS.md",
    category: "rules-context",
    scope: "inherited",
    origin: "ancestor",
    presence: "present",
    access: "read-only",
    runtimeState: "active",
    detail: "来自 Workspace 外父目录，只读"
  });
  const projectSystem = contextItem(25, {
    name: "SYSTEM.md",
    path: "/Users/test/Projects/pi-demo/.pi/SYSTEM.md",
    category: "system-prompt",
    scope: "project",
    origin: "workspace",
    presence: "missing",
    access: "creatable",
    runtimeState: "not-loaded",
    detail: "存在时覆盖全局 SYSTEM.md"
  });
  const projectAppend = contextItem(26, {
    name: "APPEND_SYSTEM.md",
    path: "/Users/test/Projects/pi-demo/.pi/APPEND_SYSTEM.md",
    category: "append-system-prompt",
    scope: "project",
    origin: "workspace",
    presence: "missing",
    access: "creatable",
    runtimeState: "not-loaded",
    detail: "存在时覆盖全局 APPEND_SYSTEM.md"
  });
  const items = [
    ...managed,
    globalAgents,
    globalSystem,
    globalAppend,
    projectAgents,
    inheritedAgents,
    projectSystem,
    projectAppend
  ];
  const contents = Object.fromEntries(items.map((item, index) => [
    item.id,
    {
      content: item.presence === "missing"
        ? ""
        : item.scope === "managed"
          ? `# ${item.name}\n\nDesktop 托管规则示例。\n\n![远程示例](https://example.invalid/context-rule.png)\n`
          : item.scope === "project"
            ? "# Project rules\n\nKeep project behavior explicit.\n"
            : item.scope === "inherited"
              ? "# Parent rules\n"
              : "# Global rules\n\nShared across workspaces.\n",
      revision: contextRevision(index + 1)
    }
  ]));
  return { catalog: { items, workspaceTrusted: true }, contents };
}

function contextItem(seed: number, fields: Omit<ContextFileSummary, "id">): ContextFileSummary {
  return { id: contextId(seed), ...fields };
}

function contextId(seed: number): string {
  return `ctx_${seed.toString(16).padStart(64, "0")}`;
}

function contextRevision(seed: number): string {
  return seed.toString(16).padStart(64, "0");
}

import {
  MAX_WORKSPACE_FILE_TABS_PER_WORKSPACE,
  MAX_WORKSPACE_FILE_TABS_TOTAL,
  type WorkspaceFileEntry,
  type WorkspaceFileOpenResult,
  type WorkspaceFilePersistedState,
  type WorkspaceFileStateSnapshot
} from "@pi67/domain";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { WorkspaceFileNavigationIntent, WorkspaceFileTab, WorkspaceFileWorkspaceState } from "./workspace-file-state.js";
interface WorkspaceFileStoreState {
  workspaces: Record<string, WorkspaceFileWorkspaceState>;
  draftPersistence: "available" | "unavailable";
  persistenceError?: string | undefined;
  hydrate: (snapshot: WorkspaceFileStateSnapshot) => void;
  setPersistenceResult: (snapshot: WorkspaceFileStateSnapshot) => void;
  setPersistenceError: (message: string | undefined) => void;
  activateConversation: (workspaceId: string) => void;
  activateTab: (workspaceId: string, relativePath: string) => void;
  beginOpen: (workspaceId: string, entry: Pick<WorkspaceFileEntry, "id" | "name" | "relativePath" | "revision">) => void;
  installResolvedEntry: (workspaceId: string, entry: WorkspaceFileEntry) => void;
  installOpenResult: (workspaceId: string, result: WorkspaceFileOpenResult, discardDraft?: boolean) => void;
  failOpen: (workspaceId: string, relativePath: string, message: string, missing?: boolean) => void;
  updateContent: (workspaceId: string, relativePath: string, content: string) => void;
  markSaved: (workspaceId: string, entry: WorkspaceFileEntry, snapshot: WorkspaceFileTab) => boolean;
  markConflict: (workspaceId: string, relativePath: string, message?: string) => void;
  closeTab: (workspaceId: string, relativePath: string) => void;
  renamePath: (workspaceId: string, previousPath: string, nextPath: string, entry: WorkspaceFileEntry) => void;
  removePath: (workspaceId: string, relativePath: string, directory: boolean) => void;
  requestNavigation: (
    workspaceId: string,
    intent: Omit<WorkspaceFileNavigationIntent, "nonce">
  ) => void;
}

export const workspaceFileStore = createStore<WorkspaceFileStoreState>((set) => ({
  workspaces: {},
  draftPersistence: "available",

  hydrate(snapshot) {
    const workspaces = Object.fromEntries(snapshot.state.workspaces.map((workspace) => {
      const byPath = Object.fromEntries(workspace.tabs.map((tab) => [
        tab.relativePath,
        {
          name: fileName(tab.relativePath),
          relativePath: tab.relativePath,
          phase: "restoring" as const,
          ...(tab.baseRevision === undefined ? {} : { revision: tab.baseRevision }),
          ...(tab.draft === undefined ? {} : { content: tab.draft }),
          dirty: tab.draft !== undefined,
          conflict: false,
          documentVersion: 0
        }
      ]));
      return [workspace.workspaceId, {
        tabs: workspace.tabs.map((tab) => tab.relativePath),
        ...(workspace.activeRelativePath === undefined ? {} : { activeRelativePath: workspace.activeRelativePath }),
        byPath
      }];
    }));
    set({
      workspaces,
      draftPersistence: snapshot.draftPersistence,
      persistenceError: undefined
    });
  },

  setPersistenceResult(snapshot) {
    set({ draftPersistence: snapshot.draftPersistence, persistenceError: undefined });
  },

  setPersistenceError(persistenceError) {
    set(persistenceError === undefined ? { persistenceError: undefined } : { persistenceError });
  },

  activateConversation(workspaceId) {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({
      ...evictCleanActive(workspace),
      activeRelativePath: undefined
    })));
  },

  activateTab(workspaceId, relativePath) {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => {
      if (!workspace.byPath[relativePath]) return workspace;
      const evicted = evictCleanActive(workspace, relativePath);
      return { ...evicted, activeRelativePath: relativePath };
    }));
  },

  beginOpen(workspaceId, entry) {
    set((state) => {
      const totalTabs = Object.values(state.workspaces).reduce((sum, workspace) => sum + workspace.tabs.length, 0);
      const existingWorkspace = state.workspaces[workspaceId] ?? emptyWorkspace();
      const existing = existingWorkspace.byPath[entry.relativePath];
      if (!existing && (
        existingWorkspace.tabs.length >= MAX_WORKSPACE_FILE_TABS_PER_WORKSPACE
        || totalTabs >= MAX_WORKSPACE_FILE_TABS_TOTAL
      )) return { persistenceError: "文件标签已达到数量上限，请先关闭不需要的标签。" };
      const evicted = evictCleanActive(existingWorkspace, entry.relativePath);
      const tab: WorkspaceFileTab = existing
        ? {
            ...existing,
            id: entry.id,
            name: entry.name,
            revision: existing.revision ?? entry.revision,
            phase: existing.phase === "ready" ? "ready" : "loading",
            reason: undefined
          }
        : {
            id: entry.id,
            name: entry.name,
            relativePath: entry.relativePath,
            phase: "loading",
            revision: entry.revision,
            dirty: false,
            conflict: false,
            documentVersion: 0
          };
      return {
        workspaces: {
          ...state.workspaces,
          [workspaceId]: {
            ...evicted,
            tabs: existing ? evicted.tabs : [...evicted.tabs, entry.relativePath],
            activeRelativePath: entry.relativePath,
            byPath: { ...evicted.byPath, [entry.relativePath]: tab }
          }
        },
        persistenceError: undefined
      };
    });
  },

  installResolvedEntry(workspaceId, entry) {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => {
      const current = workspace.byPath[entry.relativePath];
      if (!current) return workspace;
      return {
        ...workspace,
        byPath: {
          ...workspace.byPath,
          [entry.relativePath]: {
            ...current,
            id: entry.id,
            name: entry.name,
            revision: current.revision ?? entry.revision,
            phase: "loading",
            reason: undefined
          }
        }
      };
    }));
  },

  installOpenResult(workspaceId, result, discardDraft = false) {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => {
      const current = workspace.byPath[result.relativePath];
      if (!current) return workspace;
      if (result.kind !== "text") {
        if (current.dirty && current.content !== undefined && !discardDraft) {
          return {
            ...workspace,
            byPath: {
              ...workspace.byPath,
              [result.relativePath]: {
                ...current,
                id: result.id,
                phase: "ready",
                revision: result.revision,
                savedContent: "",
                conflict: true,
                reason: result.reason ?? "磁盘文件当前无法作为文本编辑，草稿已保留。",
                documentVersion: current.documentVersion + 1
              }
            }
          };
        }
        return {
          ...workspace,
          byPath: {
            ...workspace.byPath,
            [result.relativePath]: {
              ...current,
              id: result.id,
              phase: "unavailable",
              revision: result.revision,
              content: undefined,
              savedContent: undefined,
              dirty: false,
              conflict: false,
              reason: result.reason ?? "此文件不能在 Pi-67 中编辑。",
              documentVersion: current.documentVersion + 1
            }
          }
        };
      }
      const diskContent = result.content ?? "";
      const preserveDraft = current.dirty && current.content !== undefined && !discardDraft;
      const content = preserveDraft ? current.content! : diskContent;
      const conflict = preserveDraft && current.revision !== undefined && current.revision !== result.revision;
      return {
        ...workspace,
        byPath: {
          ...workspace.byPath,
          [result.relativePath]: {
            ...current,
            id: result.id,
            phase: "ready",
            revision: result.revision,
            content,
            savedContent: diskContent,
            dirty: content !== diskContent,
            conflict,
            reason: conflict ? "磁盘文件已在外部变化，草稿不会覆盖它。" : undefined,
            documentVersion: current.documentVersion + 1
          }
        }
      };
    }));
  },

  failOpen(workspaceId, relativePath, message, missing = false) {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => {
      const current = workspace.byPath[relativePath];
      if (!current) return workspace;
      return {
        ...workspace,
        byPath: {
          ...workspace.byPath,
          [relativePath]: {
            ...current,
            phase: missing ? "missing" : "unavailable",
            reason: message
          }
        }
      };
    }));
  },

  updateContent(workspaceId, relativePath, content) {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => {
      const current = workspace.byPath[relativePath];
      if (!current || current.phase !== "ready") return workspace;
      return {
        ...workspace,
        byPath: {
          ...workspace.byPath,
          [relativePath]: {
            ...current,
            content,
            dirty: content !== (current.savedContent ?? "")
          }
        }
      };
    }));
  },

  markSaved(workspaceId, entry, snapshot) {
    let fullySaved = false;
    set((state) => updateWorkspace(state, workspaceId, (workspace) => {
      const current = workspace.byPath[entry.relativePath];
      if (!current || current.id !== snapshot.id || current.revision !== snapshot.revision
        || current.documentVersion !== snapshot.documentVersion) return workspace;
      fullySaved = current.content === snapshot.content;
      return {
        ...workspace,
        byPath: {
          ...workspace.byPath,
          [entry.relativePath]: {
            ...current,
            id: entry.id,
            revision: entry.revision,
            savedContent: snapshot.content ?? "",
            dirty: !fullySaved,
            conflict: false,
            reason: undefined
          }
        }
      };
    }));
    return fullySaved;
  },

  markConflict(workspaceId, relativePath, message) {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => {
      const current = workspace.byPath[relativePath];
      if (!current) return workspace;
      return {
        ...workspace,
        byPath: {
          ...workspace.byPath,
          [relativePath]: {
            ...current,
            conflict: true,
            reason: message ?? "磁盘文件已变化，草稿不会覆盖它。"
          }
        }
      };
    }));
  },

  closeTab(workspaceId, relativePath) {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => {
      const index = workspace.tabs.indexOf(relativePath);
      if (index < 0) return workspace;
      const tabs = workspace.tabs.filter((path) => path !== relativePath);
      const byPath = { ...workspace.byPath };
      delete byPath[relativePath];
      const activeRelativePath = workspace.activeRelativePath === relativePath
        ? tabs[Math.min(index, tabs.length - 1)]
        : workspace.activeRelativePath;
      return { tabs, byPath, ...(activeRelativePath === undefined ? {} : { activeRelativePath }) };
    }));
  },

  renamePath(workspaceId, previousPath, nextPath, entry) {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => {
      const affected = workspace.tabs.filter((path) => path === previousPath || path.startsWith(`${previousPath}/`));
      if (affected.length === 0) return workspace;
      const replacements = new Map(affected.map((path) => [path, `${nextPath}${path.slice(previousPath.length)}`]));
      const byPath = { ...workspace.byPath };
      for (const path of affected) {
        const current = byPath[path];
        const replacement = replacements.get(path)!;
        if (!current) continue;
        delete byPath[path];
        byPath[replacement] = {
          ...current,
          ...(path === previousPath ? { id: entry.id, revision: entry.revision } : {}),
          name: fileName(replacement),
          relativePath: replacement
        };
      }
      return {
        tabs: workspace.tabs.map((path) => replacements.get(path) ?? path),
        byPath,
        ...(workspace.activeRelativePath === undefined
          ? {}
          : { activeRelativePath: replacements.get(workspace.activeRelativePath) ?? workspace.activeRelativePath })
      };
    }));
  },

  removePath(workspaceId, relativePath, directory) {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => {
      const removed = new Set(workspace.tabs.filter((path) => (
        path === relativePath || (directory && path.startsWith(`${relativePath}/`))
      )));
      if (removed.size === 0) return workspace;
      const tabs = workspace.tabs.filter((path) => !removed.has(path));
      const byPath = Object.fromEntries(Object.entries(workspace.byPath).filter(([path]) => !removed.has(path)));
      const activeRelativePath = workspace.activeRelativePath && !removed.has(workspace.activeRelativePath)
        ? workspace.activeRelativePath
        : undefined;
      return { tabs, byPath, ...(activeRelativePath === undefined ? {} : { activeRelativePath }) };
    }));
  },

  requestNavigation(workspaceId, intent) {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({
      ...workspace,
      navigation: {
        ...intent,
        nonce: (workspace.navigation?.nonce ?? 0) + 1
      }
    })));
  }
}));

export function useWorkspaceFileStore<T>(selector: (state: WorkspaceFileStoreState) => T): T {
  return useStore(workspaceFileStore, selector);
}

export function activateWorkspaceConversation(workspaceId: string): void {
  workspaceFileStore.getState().activateConversation(workspaceId);
}

export function workspaceHasDirtyPath(workspaceId: string, relativePath: string, directory: boolean): boolean {
  const workspace = workspaceFileStore.getState().workspaces[workspaceId];
  if (!workspace) return false;
  return workspace.tabs.some((path) => (
    (path === relativePath || (directory && path.startsWith(`${relativePath}/`)))
    && workspace.byPath[path]?.dirty
  ));
}

export function hasUnpersistedWorkspaceDrafts(): boolean {
  const state = workspaceFileStore.getState();
  return state.draftPersistence === "unavailable"
    && Object.values(state.workspaces).some((workspace) => (
      workspace.tabs.some((path) => workspace.byPath[path]?.dirty)
    ));
}

export function serializeWorkspaceFileState(): WorkspaceFilePersistedState {
  const state = workspaceFileStore.getState();
  return {
    version: 1,
    workspaces: Object.entries(state.workspaces)
      .filter(([, workspace]) => workspace.tabs.length > 0)
      .map(([workspaceId, workspace]) => ({
        workspaceId,
        tabs: workspace.tabs.map((relativePath) => {
          const tab = workspace.byPath[relativePath]!;
          return {
            relativePath,
            ...(tab.dirty && tab.revision && tab.content !== undefined
              ? { baseRevision: tab.revision, draft: tab.content }
              : {})
          };
        }),
        ...(workspace.activeRelativePath === undefined ? {} : { activeRelativePath: workspace.activeRelativePath })
      }))
  };
}

function updateWorkspace(
  state: WorkspaceFileStoreState,
  workspaceId: string,
  update: (workspace: WorkspaceFileWorkspaceState) => WorkspaceFileWorkspaceState
): Partial<WorkspaceFileStoreState> {
  const current = state.workspaces[workspaceId] ?? emptyWorkspace();
  const next = update(current);
  if (next === current) return {};
  return { workspaces: { ...state.workspaces, [workspaceId]: next } };
}

function evictCleanActive(
  workspace: WorkspaceFileWorkspaceState,
  nextActive?: string
): WorkspaceFileWorkspaceState {
  const active = workspace.activeRelativePath;
  if (!active || active === nextActive) return workspace;
  const tab = workspace.byPath[active];
  if (!tab || tab.dirty || tab.phase !== "ready") return workspace;
  return {
    ...workspace,
    byPath: {
      ...workspace.byPath,
      [active]: {
        ...tab,
        phase: "restoring",
        content: undefined,
        savedContent: undefined,
        reason: undefined
      }
    }
  };
}

function emptyWorkspace(): WorkspaceFileWorkspaceState {
  return { tabs: [], byPath: {} };
}

function fileName(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}

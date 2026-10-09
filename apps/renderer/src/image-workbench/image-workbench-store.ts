import type { ImageProjectSummary } from "@pi67/protocol";
import { create } from "zustand";

export type ImageInspectorTab = "layers" | "properties" | "candidates" | "history" | "export";
type ImageWorkbenchView = { kind: "library" } | { kind: "project"; projectId: string };
interface ImageThumbnail { pngSha256: string; width: number; height: number; revision: number }

interface ImageWorkbenchState {
  /** Layout only, like Work/Chat: undefined shows the ordinary Work surface. */
  view: ImageWorkbenchView | undefined;
  phase: "idle" | "loading" | "ready" | "failed";
  error: string | undefined;
  projects: ImageProjectSummary[];
  thumbnails: Record<string, ImageThumbnail>;
  inspectorTab: ImageInspectorTab;
  setInspectorTab: (tab: ImageInspectorTab) => void;
  openLibrary: () => void;
  openProject: (projectId: string) => void;
  close: () => void;
  setLoading: () => void;
  setProjects: (projects: ImageProjectSummary[]) => void;
  setThumbnail: (projectId: string, thumbnail: ImageThumbnail) => void;
  fail: (message: string) => void;
}

export const useImageWorkbench = create<ImageWorkbenchState>((set) => ({
  view: undefined,
  phase: "idle",
  error: undefined,
  projects: [],
  thumbnails: {},
  inspectorTab: "layers",
  setInspectorTab(inspectorTab) { set({ inspectorTab }); },
  openLibrary() { set({ view: { kind: "library" } }); },
  openProject(projectId) { set({ view: { kind: "project", projectId } }); },
  close() { set({ view: undefined }); },
  setLoading() { set((state) => ({ phase: state.phase === "ready" ? "ready" : "loading", error: undefined })); },
  setProjects(projects) {
    // Most recently updated first, the library's only order (product model §5.3).
    set({ phase: "ready", error: undefined, projects: [...projects].sort((a, b) => b.updatedAt - a.updatedAt) });
  },
  setThumbnail(projectId, thumbnail) { set((state) => ({ thumbnails: { ...state.thumbnails, [projectId]: thumbnail } })); },
  fail(error) { set({ phase: "failed", error }); }
}));

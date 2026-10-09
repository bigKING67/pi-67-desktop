import { afterEach, describe, expect, it } from "vitest";
import type { ImageProjectSummary } from "@pi67/protocol";
import { imagePreviewUrl, newImageProjectId } from "./image-workbench-controller.js";
import { useImageWorkbench } from "./image-workbench-store.js";

const project = (projectId: string, updatedAt: number): ImageProjectSummary => ({ projectId, title: projectId, revision: 1, canvas: { width: 1080, height: 1350, background: "#ffffff" }, updatedAt, readyCandidates: 0 });

afterEach(() => { useImageWorkbench.setState({ view: undefined, phase: "idle", error: undefined, projects: [], thumbnails: {} }); });

describe("image workbench state", () => {
  it("orders the library by most recent update and keeps the view as layout state", () => {
    const store = useImageWorkbench.getState();
    store.setProjects([project("old", 1), project("new", 3), project("mid", 2)]);
    expect(useImageWorkbench.getState().projects.map((item) => item.projectId)).toEqual(["new", "mid", "old"]);
    store.openProject("new");
    expect(useImageWorkbench.getState().view).toEqual({ kind: "project", projectId: "new" });
    store.close();
    expect(useImageWorkbench.getState().view).toBeUndefined();
    store.fail("磁盘不可用");
    expect(useImageWorkbench.getState()).toMatchObject({ phase: "failed", error: "磁盘不可用" });
  });

  it("names projects with engine-safe ids and previews by Workspace, project and digest", () => {
    expect(newImageProjectId(new Date("2026-10-09T08:00:00Z"), () => 0.5)).toBe("image-20261009-8000");
    expect(/^[a-z][a-z0-9_-]{0,63}$/u.test(newImageProjectId())).toBe(true);
    expect(imagePreviewUrl("w 1", "poster", "a".repeat(64))).toBe(`app://pi67/image/w%201/poster/${"a".repeat(64)}.png`);
  });
});

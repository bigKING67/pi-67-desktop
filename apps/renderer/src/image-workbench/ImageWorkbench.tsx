import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { imagePreviewUrl } from "./image-workbench-controller.js";
import { ImageLibrary } from "./ImageLibrary.js";
import { useImageWorkbench } from "./image-workbench-store.js";
import styles from "./ImageWorkbench.module.css";
import { agentConnectionController } from "../connection/AgentConnectionController.js";

/** The `图像` destination: the creative library, or one project opened from it. */
export function ImageWorkbench() {
  const view = useImageWorkbench((state) => state.view);
  return view?.kind === "project" ? <ImageProjectPage projectId={view.projectId} /> : <ImageLibrary />;
}

const CANVAS_PREVIEW_EDGE = 1600;

function ImageProjectPage({ projectId }: { projectId: string }) {
  const libraryId = useWorkbenchStore((state) => state.imageLibraryWorkspaceId);
  const project = useImageWorkbench((state) => state.projects.find((item) => item.projectId === projectId));
  const openLibrary = useImageWorkbench((state) => state.openLibrary);
  const [preview, setPreview] = useState<{ sha: string; revision: number }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!libraryId) return;
    let cancelled = false;
    setError(undefined);
    void agentConnectionController.request("image.project.render", { projectId, previewMax: CANVAS_PREVIEW_EDGE }, [], { context: { scope: "workspace", workspaceId: libraryId } })
      .then((result) => { if (!cancelled) setPreview({ sha: result.pngSha256, revision: result.revision }); },
        (reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "渲染失败"); });
    return () => { cancelled = true; };
  }, [libraryId, projectId, project?.revision]);

  return (
    <section aria-label={project?.title ?? "图像项目"} className={styles.project} data-testid="image-project">
      <header className={styles.projectHeader}>
        <Button className={styles.backAction!} onPress={openLibrary}><ArrowLeft aria-hidden="true" size={15} />创作库</Button>
        <span className={styles.projectTitle}>{project?.title ?? projectId}</span>
        {project ? <span className={styles.projectMeta}>{project.canvas.width}×{project.canvas.height} · 修订 {preview?.revision ?? project.revision}</span> : null}
      </header>
      <div className={styles.canvasStage}>
        {error ? <p className={styles.loading} role="alert">{error}</p>
          : preview && libraryId ? <img alt={`${project?.title ?? "图像"} 当前修订`} className={styles.canvasImage} src={imagePreviewUrl(libraryId, projectId, preview.sha)} />
            : <p className={styles.loading} role="status">正在渲染…</p>}
      </div>
    </section>
  );
}

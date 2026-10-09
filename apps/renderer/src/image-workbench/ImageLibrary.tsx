import type { ImageProjectSummary } from "@pi67/protocol";
import { FolderOpen, ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { chooseImageLibrary, imagePreviewUrl, loadImageLibrary, subscribeImageLibraryChanges } from "./image-workbench-controller.js";
import { useImageWorkbench } from "./image-workbench-store.js";
import styles from "./ImageWorkbench.module.css";
import { NewImageFromPhotoDialog } from "./NewImageFromPhotoDialog.js";

const PHOTO_TYPES = "image/png,image/jpeg,image/webp";

/** `图像` → the creative library: every project as a card, most recently updated first. */
export function ImageLibrary() {
  const libraryId = useWorkbenchStore((state) => state.imageLibraryWorkspaceId);
  const library = useWorkbenchStore((state) => (state.imageLibraryWorkspaceId ? state.workspaces[state.imageLibraryWorkspaceId] : undefined));
  const phase = useImageWorkbench((state) => state.phase);
  const error = useImageWorkbench((state) => state.error);
  const projects = useImageWorkbench((state) => state.projects);
  const [photo, setPhoto] = useState<File>();
  const [choosing, setChoosing] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!libraryId) return undefined;
    void loadImageLibrary();
    return subscribeImageLibraryChanges();
  }, [libraryId]);

  const pickPhoto = () => input.current?.click();
  const fromPhoto = (
    <Button className="primary-button" onPress={pickPhoto}>
      <ImagePlus aria-hidden="true" size={14} />从图片开始
    </Button>
  );

  return (
    <section aria-labelledby="image-library-title" className={styles.library} data-testid="image-library">
      <header className={styles.libraryHeader}>
        <span className={styles.libraryHeading}>
          <h1 id="image-library-title">创作库</h1>
          {library ? <span className={styles.libraryPath} title={library.identity.canonicalPath}>{library.identity.canonicalPath.split(/[\\/]/u).filter(Boolean).at(-1)}</span> : null}
        </span>
        {library && projects.length > 0 ? fromPhoto : null}
      </header>
      <input ref={input} accept={PHOTO_TYPES} className={styles.fileInput} tabIndex={-1} type="file"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) setPhoto(file); }} />

      {!library ? (
        <div className={styles.emptyState} role="status">
          <FolderOpen aria-hidden="true" className={styles.emptyGlyph} size={20} />
          <h2>先选择创作库的位置</h2>
          <p>图像项目、候选和导出都保存在这个文件夹里，只需选择一次。建议放在空间充足的磁盘上。</p>
          <Button className="primary-button" isDisabled={choosing} onPress={() => { setChoosing(true); void chooseImageLibrary().finally(() => setChoosing(false)); }}>
            {choosing ? "等待选择…" : "选择文件夹"}
          </Button>
        </div>
      ) : phase === "failed" ? (
        <div className={styles.emptyState} role="alert">
          <h2>创作库暂时读不出来</h2>
          <p>{error}</p>
          <Button className="secondary-button" onPress={() => void loadImageLibrary()}>重试</Button>
        </div>
      ) : phase !== "ready" ? (
        <p className={styles.loading} role="status">正在读取创作库…</p>
      ) : projects.length === 0 ? (
        <div className={styles.emptyState} role="status">
          <ImagePlus aria-hidden="true" className={styles.emptyGlyph} size={20} />
          <h2>还没有图像项目</h2>
          <p>选一张产品照片开始：照片保持原样，标题和文案是可编辑的文字层。之后在对话里说要做什么，比如换背景、加标题。</p>
          {fromPhoto}
        </div>
      ) : (
        <ul aria-label="图像项目" className={styles.grid}>
          {projects.map((project) => <ProjectCard key={project.projectId} libraryId={library.id} project={project} />)}
        </ul>
      )}
      {photo ? <NewImageFromPhotoDialog photo={photo} onDismiss={() => setPhoto(undefined)} /> : null}
    </section>
  );
}

function ProjectCard({ libraryId, project }: { libraryId: string; project: ImageProjectSummary }) {
  const thumbnail = useImageWorkbench((state) => state.thumbnails[project.projectId]);
  const openProject = useImageWorkbench((state) => state.openProject);
  const { width, height } = project.canvas;
  const meta = [`${width}×${height}`, `修订 ${project.revision}`, ...(project.readyCandidates ? [`${project.readyCandidates} 个候选待选`] : []), updatedLabel(project.updatedAt)];
  return (
    <li>
      <Button aria-label={`打开 ${project.title}`} className={styles.card!} onPress={() => openProject(project.projectId)}>
        <span className={styles.cardMedia}>
          {thumbnail ? <img alt="" decoding="async" loading="lazy" src={imagePreviewUrl(libraryId, project.projectId, thumbnail.pngSha256)} /> : null}
        </span>
        <span className={styles.cardTitle}>{project.title}</span>
        <span className={styles.cardMeta}>{meta.join(" · ")}</span>
      </Button>
    </li>
  );
}

function updatedLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? `今天 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    : `${date.getMonth() + 1}月${date.getDate()}日`;
}

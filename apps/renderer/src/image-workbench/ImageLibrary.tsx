import type { ImageProjectSummary } from "@pi67/protocol";
import { ArrowLeft, FolderOpen, ImagePlus, Palette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { chooseImageLibrary, ensureLibraryThumbnails, imagePreviewUrl, loadImageLibrary, subscribeImageLibraryChanges } from "./image-workbench-controller.js";
import { batchGroups, type BatchGroup } from "./image-batch-groups.js";
import { removeImageBatch } from "./image-project-batch.js";
import { ImageBatchRemoveDialog } from "./ImageBatchPanel.js";
import { ImageBrandDialog } from "./ImageBrandDialog.js";
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
  const view = useImageWorkbench((state) => state.view);
  const openBatchId = view?.kind === "library" ? view.batchId : undefined;
  // A batch that is gone (removed here, in another window or by the Agent) leaves the library on all projects.
  const batch = openBatchId ? batchGroups(projects).find((group) => group.batchId === openBatchId)?.members : undefined;
  // Opening a batch draws its rows, and redraws any whose revision moved; the library draws one cover per batch.
  const drawn = batch?.map((project) => `${project.projectId}:${project.revision}`).join(",");
  useEffect(() => { if (batch?.length) ensureLibraryThumbnails(batch); }, [drawn]);
  const [photo, setPhoto] = useState<File>();
  const [choosing, setChoosing] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
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
        <span className={styles.libraryActions}>
          {library ? <Button className="secondary-button" onPress={() => setBrandOpen(true)}><Palette aria-hidden="true" size={14} />品牌库</Button> : null}
          {library && projects.length > 0 ? fromPhoto : null}
        </span>
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
      ) : batch ? (
        <BatchView batchId={openBatchId!} libraryId={library.id} members={batch} />
      ) : (
        <>
        {projects.some((project) => project.template) ? (
          <>
            <h2 className={styles.librarySection}>模板</h2>
            <ul aria-label="模板" className={styles.grid}>
              {projects.filter((project) => project.template).map((project) => <ProjectCard key={project.projectId} libraryId={library.id} project={project} />)}
            </ul>
            <h2 className={styles.librarySection}>项目</h2>
          </>
        ) : null}
        <ul aria-label="图像项目" className={styles.grid}>
          {libraryEntries(projects.filter((project) => !project.template)).map((entry) => "batchId" in entry
            ? <BatchCard key={entry.batchId} batchId={entry.batchId} libraryId={library.id} members={entry.members} />
            : <ProjectCard key={entry.projectId} libraryId={library.id} project={entry} />)}
        </ul>
        </>
      )}
      <ImageBatchRemoveDialog />
      {brandOpen ? <ImageBrandDialog onDismiss={() => setBrandOpen(false)} /> : null}
      {photo ? <NewImageFromPhotoDialog photo={photo} onDismiss={() => setPhoto(undefined)} /> : null}
    </section>
  );
}

/** Projects in library order, each batch folded into one entry where its newest row would stand. */
function libraryEntries(projects: readonly ImageProjectSummary[]): (ImageProjectSummary | BatchGroup)[] {
  const groups = new Map(batchGroups(projects).map((group) => [group.batchId, group]));
  const entries: (ImageProjectSummary | BatchGroup)[] = [];
  for (const project of projects) {
    if (!project.batch) entries.push(project);
    else if (groups.has(project.batch.batchId)) { entries.push(groups.get(project.batch.batchId)!); groups.delete(project.batch.batchId); }
  }
  return entries;
}

function BatchCard({ libraryId, batchId, members }: { libraryId: string; batchId: string; members: readonly ImageProjectSummary[] }) {
  const projects = useImageWorkbench((state) => state.projects);
  const openLibrary = useImageWorkbench((state) => state.openLibrary);
  const cover = members[0]!, thumbnail = useImageWorkbench((state) => state.thumbnails[cover.projectId]);
  const source = projects.find((item) => item.projectId === cover.batch!.projectId);
  const title = `批次 · ${source?.title ?? cover.batch!.projectId}`;
  return (
    <li>
      <Button aria-label={`打开${title}`} className={styles.card!} onPress={() => openLibrary(batchId)}>
        <span className={`${styles.cardMedia} ${styles.cardStack}`}>
          {thumbnail ? <img alt="" decoding="async" loading="lazy" src={imagePreviewUrl(libraryId, cover.projectId, thumbnail.pngSha256)} /> : null}
        </span>
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardMeta}>{[`${members.length} 个变体`, `基于修订 ${cover.batch!.revision}`, updatedLabel(Math.max(...members.map((item) => item.updatedAt)))].join(" · ")}</span>
      </Button>
    </li>
  );
}

/** One batch opened from the library: its rows in table order, removable as one. */
function BatchView({ libraryId, batchId, members }: { libraryId: string; batchId: string; members: readonly ImageProjectSummary[] }) {
  const projects = useImageWorkbench((state) => state.projects);
  const openLibrary = useImageWorkbench((state) => state.openLibrary);
  const source = projects.find((item) => item.projectId === members[0]!.batch!.projectId);
  return (
    <>
      <div className={styles.batchBar}>
        <Button className={styles.back!} onPress={() => openLibrary()}><ArrowLeft aria-hidden="true" size={15} />全部项目</Button>
        <span className={styles.batchTitle}>批次 · {source?.title ?? members[0]!.batch!.projectId} · {members.length} 个变体</span>
        <Button className="secondary-button" onPress={() => void removeImageBatch(batchId)}>撤销批次</Button>
      </div>
      <ul aria-label="批次里的项目" className={styles.grid}>
        {members.map((project) => <ProjectCard key={project.projectId} libraryId={libraryId} project={project} />)}
      </ul>
    </>
  );
}

function ProjectCard({ libraryId, project }: { libraryId: string; project: ImageProjectSummary }) {
  const projects = useImageWorkbench((state) => state.projects);
  const thumbnail = useImageWorkbench((state) => state.thumbnails[project.projectId]);
  const openProject = useImageWorkbench((state) => state.openProject);
  const { width, height } = project.canvas;
  const source = project.derivedFrom ? projects.find((item) => item.projectId === project.derivedFrom!.projectId) : undefined;
  const meta = [`${width}×${height}`, `修订 ${project.revision}`, ...(project.derivedFrom ? [`派生自 ${source?.title ?? project.derivedFrom.projectId}`] : []),
    ...(project.batch ? [`第 ${project.batch.row} 行`] : []),
    ...(project.fromTemplate ? [`来自模板 ${projects.find((item) => item.projectId === project.fromTemplate!.projectId)?.title ?? project.fromTemplate.projectId}`] : []),
    ...(project.readyCandidates ? [`${project.readyCandidates} 个候选待选`] : []), updatedLabel(project.updatedAt)];
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

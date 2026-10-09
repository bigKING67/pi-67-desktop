import { ImageLibrary } from "./ImageLibrary.js";
import { ImageProjectPage } from "./ImageProjectPage.js";
import { useImageWorkbench } from "./image-workbench-store.js";

/** The `图像` destination: the creative library, or one project opened from it. */
export function ImageWorkbench() {
  const view = useImageWorkbench((state) => state.view);
  return view?.kind === "project" ? <ImageProjectPage projectId={view.projectId} /> : <ImageLibrary />;
}

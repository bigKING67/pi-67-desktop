// Runs inside the packaged executable (ELECTRON_RUN_AS_NODE): loads the image
// engine from app.asar and renders one CJK text project, which exercises Sharp,
// resvg, Satori, the bundled font and the render worker together.
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const engine = await import(pathToFileURL(process.argv[2]).href);
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi67-image-probe-"));
try {
  const root = engine.projectRoot(cwd, "probe");
  await engine.ensureProjectParent(root);
  await engine.createProject(root, {
    project_id: "probe", title: "探针", canvas: { width: 320, height: 200, background: "#ffffff" }, assets: [],
    objects: [{ id: "headline", kind: "text", locked: false, visible: true, x: 16, y: 16, width: 288, height: 80, opacity: 1,
      text: "春季新品 ¥199", font_size: 32, color: "#111111", align: "left", line_height: 1.2 }]
  });
  const output = await engine.workDirectory(cwd, "probe", "preview");
  const { receipt } = await engine.renderProject(root, output, { previewMax: 320 });
  const png = await fs.readFile(path.join(output, "image.png"));
  if (png.subarray(1, 4).toString("latin1") !== "PNG" || !receipt.outputs?.png) throw new Error("Packaged image render produced no PNG.");
  console.log(JSON.stringify({ status: "rendered", revision: receipt.revision, bytes: png.length }));
} finally {
  await fs.rm(cwd, { recursive: true, force: true });
}

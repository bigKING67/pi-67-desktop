import { expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLazyImportExperiment, patchLazyImportSource } from "../../../eng/capabilities/private-memory-lazy-import.test-support.mjs";

it("refuses unpinned source and unknown experiment targets", () => {
  for (const experiment of ["otel", "litellm"] as const) {
    for (const path of ["openviking/metrics/exporters/__init__.py", "openviking/metrics/global_api.py",
      "openviking/models/vlm/__init__.py", "openviking/models/embedder/__init__.py",
      "openviking_cli/utils/config/embedding_config.py", "other.py"]) {
      expect(() => patchLazyImportSource(experiment, path, "synthetic drift")).toThrow("exact pinned upstream");
    }
  }
});

it("refuses to patch outside the fixture installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "new-money-lazy-otel-guard-"));
  try {
    for (const experiment of ["otel", "litellm"] as const) {
      await expect(applyLazyImportExperiment(experiment, root, root)).rejects.toThrow("fresh fixture installation");
    }
    expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

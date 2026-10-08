import path from "node:path";
import { IMAGE_ID_PATTERN, IMAGE_PROJECT_LIMITS, type ImageCandidateListStatus, type ImageDocument as DomainDocument } from "@pi67/domain";
import { isImageDocument } from "@pi67/protocol";
import { describe, expect, expectTypeOf, it } from "vitest";
import { LIMITS, type ImageDocument } from "./document.js";
import { createProject, editBatch, readProject } from "./project.js";
import { stageCandidate, acceptCandidate, listCandidates, type CandidateListFailure, type CandidateInspection } from "./candidates.js";
import { demoInput, candidateFixtures } from "./test-support/fixtures.js";
import { batch, tempDirectory, update } from "./test-support/harness.js";

// The engine is the project's source of truth; domain mirrors its types for the
// protocol and the renderer. These checks fail when either side drifts.
describe("image engine ↔ domain/protocol parity", { timeout: 120_000 }, () => {
  it("shares limits, identifier rules and document types with domain", () => {
    expect(IMAGE_PROJECT_LIMITS).toMatchObject({ pixels: LIMITS.pixels, objects: LIMITS.objects, assets: LIMITS.assets, operations: LIMITS.operations, revisions: LIMITS.revisions });
    expect(new RegExp(IMAGE_ID_PATTERN, "u").source).toBe(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.source);
    expectTypeOf<ImageDocument>().toEqualTypeOf<DomainDocument>();
    expectTypeOf<CandidateInspection["status"] | CandidateListFailure["status"]>().toEqualTypeOf<ImageCandidateListStatus>();
  });

  it("every document the engine publishes passes the protocol schema", async () => {
    const directory = await tempDirectory("image-engine-parity-");
    const root = path.join(directory, "project");
    await createProject(root, await demoInput(path.join(directory, "source")));
    const sources = await candidateFixtures(path.join(directory, "candidates"));
    await stageCandidate(root, { id: "pink", base_revision: 1, target_id: "background", source: sources.backgrounds[0], mode: "replace", summary: "Pink" });
    await acceptCandidate(root, { candidate_id: "pink", base_revision: 1, author: "agent", summary: "Accept" });
    await editBatch(root, batch(2, [update("headline", { text: "自在新生" }), { type: "set_canvas", canvas: { width: 1000, height: 1200, background: "#ffffff" } }], "human"));
    await editBatch(root, batch(3, [{ type: "revert_to", revision: 1 }], "human"));
    const latest = (await readProject(root)).latest_revision;
    for (let revision = 1; revision <= latest; revision++) {
      const { document } = await readProject(root, { revision });
      expect(isImageDocument(document), `revision ${revision}`).toBe(true);
    }
    expect((await listCandidates(root)).map((item) => item.status)).toEqual(["accepted"]);
  });
});

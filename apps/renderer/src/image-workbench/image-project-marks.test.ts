import { beforeEach, describe, expect, it } from "vitest";
import { IMAGE_PROMPT_CONTEXT_LIMITS } from "@pi67/domain";
import { useImageProject } from "./image-project-controller.js";
import { addImageMark, removeImageMark, resolveImageReferences, retireImageMarks, sendableImageMarks, setImageMarkInstruction, setImageReference } from "./image-project-marks.js";

const box = { x: 10.4, y: 20.6, width: 40, height: 30 };

describe("image marks and references", () => {
  beforeEach(() => useImageProject.setState({ marks: [], references: [], document: undefined }));

  it("numbers marks from the lowest free id, rounds to canvas pixels and ignores stray clicks", () => {
    expect(addImageMark(box)).toBe("m1");
    expect(addImageMark(box)).toBe("m2");
    expect(addImageMark({ ...box, width: 3 })).toBeUndefined();
    removeImageMark("m1");
    expect(addImageMark(box)).toBe("m1");
    expect(useImageProject.getState().marks.find((mark) => mark.id === "m1")).toMatchObject({ x: 10, y: 21, width: 40, height: 30, instruction: "" });
  });

  it("stops at the context limit", () => {
    for (let index = 0; index < IMAGE_PROMPT_CONTEXT_LIMITS.marks; index += 1) addImageMark(box);
    expect(addImageMark(box)).toBeUndefined();
  });

  it("sends only marks with words and retires exactly the sent ones", () => {
    addImageMark(box); addImageMark(box); addImageMark(box);
    setImageMarkInstruction("m1", "换成木纹");
    setImageMarkInstruction("m2", "  ");
    const sent = sendableImageMarks(useImageProject.getState().marks);
    expect(sent.map((mark) => mark.id)).toEqual(["m1"]);
    // Reworded while the message was in flight: the new words were not sent and stay.
    setImageMarkInstruction("m1", "换成大理石");
    retireImageMarks(sent);
    expect(useImageProject.getState().marks.map((mark) => mark.id)).toEqual(["m1", "m2", "m3"]);
    retireImageMarks(sendableImageMarks(useImageProject.getState().marks));
    expect(useImageProject.getState().marks.map((mark) => mark.id)).toEqual(["m2", "m3"]);
  });

  it("clips a framed region that bleeds past the canvas, so the mark is never dropped from the message", () => {
    useImageProject.setState({ document: { canvas: { width: 100, height: 80 } } as never });
    addImageMark({ x: -20, y: 60, width: 60, height: 40 });
    expect(useImageProject.getState().marks[0]).toMatchObject({ x: 0, y: 60, width: 40, height: 20 });
    expect(addImageMark({ x: -50, y: 0, width: 52, height: 40 })).toBeUndefined();
  });

  it("gives each layer one role, removes it with undefined, caps references and sends the layer's current asset", () => {
    setImageReference("a", "keep-style");
    setImageReference("a", "keep-subject");
    expect(useImageProject.getState().references).toEqual([{ objectId: "a", role: "keep-subject" }]);
    setImageReference("b", "keep-style"); setImageReference("c", "take-composition");
    expect(useImageProject.getState().references.map((reference) => reference.objectId)).toEqual(["a", "b"]);
    const document = { objects: [{ id: "a", kind: "image", asset_id: "accepted-output" }, { id: "b", kind: "text" }] } as never;
    expect(resolveImageReferences(document, useImageProject.getState().references)).toEqual([{ assetId: "accepted-output", role: "keep-subject" }]);
    setImageReference("a", undefined);
    expect(useImageProject.getState().references.map((reference) => reference.objectId)).toEqual(["b"]);
  });
});

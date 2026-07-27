import { describe, expect, it } from "vitest";
import { projectQueue } from "./composer-queue-projection.js";

describe("composer queue projection", () => {
  it("preserves delivery groups and reports their full counts", () => {
    expect(projectQueue(["steer one"], ["follow one", "follow two"])).toMatchObject({
      steeringCount: 1,
      followUpCount: 2,
      hiddenCount: 0,
      items: [
        { id: "steer-0", kind: "steer", preview: "steer one", truncated: false },
        { id: "follow-up-0", kind: "follow-up", preview: "follow one", truncated: false },
        { id: "follow-up-1", kind: "follow-up", preview: "follow two", truncated: false }
      ]
    });
  });

  it("mounts at most twenty previews while retaining bounded summary counts", () => {
    const projection = projectQueue(
      Array.from({ length: 12 }, (_, index) => `steer ${index}`),
      Array.from({ length: 15 }, (_, index) => `follow ${index}`)
    );

    expect(projection.items).toHaveLength(20);
    expect(projection.hiddenCount).toBe(7);
    expect(projection.steeringCount).toBe(12);
    expect(projection.followUpCount).toBe(15);
  });

  it("removes control characters and truncates long previews", () => {
    const message = `line\n\u0000next ${"x".repeat(520)}`;
    const item = projectQueue([message], []).items[0];

    expect(item).toBeDefined();
    expect(Array.from(item?.preview ?? "").every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })).toBe(true);
    expect(item?.preview.length).toBeLessThanOrEqual(500);
    expect(item?.truncated).toBe(true);
  });
});

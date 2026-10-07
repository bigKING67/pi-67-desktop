import { describe, expect, it } from "vitest";
import { reasoningPreview } from "./reasoning-preview.js";

describe("reasoningPreview", () => {
  it("shows the latest sentence of the latest paragraph", () => {
    expect(reasoningPreview("First idea.\n\nLet me check. I should report this clearly"))
      .toBe("I should report this clearly");
  });

  it("splits Chinese sentences and keeps their punctuation", () => {
    expect(reasoningPreview("先读 README。然后看 package.json。")).toBe("然后看 package.json。");
  });

  it("strips Markdown markers", () => {
    expect(reasoningPreview("## Plan\n- **check** `git status`")).toBe("check git status");
  });

  it("bounds long sentences", () => {
    const preview = reasoningPreview("a".repeat(400));
    expect(preview).toHaveLength(160);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("returns empty text for blank reasoning", () => {
    expect(reasoningPreview("  \n\n ")).toBe("");
  });
});

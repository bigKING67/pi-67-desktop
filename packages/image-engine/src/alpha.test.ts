import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAlphaAcceptance } from "./test-support/alpha-acceptance.js";
import { tempDirectory } from "./test-support/harness.js";

describe("RGBA acceptance", { timeout: 180_000 }, () => {
  it("known RGBA product survives background candidates, scale, opacity, crop, undo and relocation", async () => {
    const directory = await tempDirectory("image-engine-alpha-");
    const report = await runAlphaAcceptance(path.join(directory, "acceptance"));
    expect(report.status).toBe("PASS");
  });
});

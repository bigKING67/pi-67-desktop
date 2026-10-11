import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import * as engine from "../../../packages/image-engine/src/index.ts";
import { buildGoldenSet, DEFECTS, goldenCases, posterObjects, shade } from "./golden.mjs";
import { scoreAnswers } from "./metrics.mjs";
import { renderReport } from "./report.mjs";
import { parseAnswer, RUBRIC, rubricHash, rubricItems, rubricPrompt } from "./rubric.mjs";

describe("image VLM review golden set", () => {
  it("covers every defect on every theme, with clean posters, and asks one question per defect", () => {
    const cases = goldenCases();
    expect(cases).toHaveLength(45);
    for (const defect of DEFECTS) expect(cases.filter((item) => item.defect === defect)).toHaveLength(5);
    expect(cases.filter((item) => item.defect === "none")).toHaveLength(10);
    expect(RUBRIC.map((item) => item.id)).toEqual(DEFECTS);
    expect(shade("#ffffff", 16)).toBe("#efefef");
    expect(shade("#000000", 16)).toBe("#101010");
  });

  it("applies each defect to the poster's objects and nothing else", () => {
    const theme = goldenCases()[0].theme, brief = { headline: "春日茶礼", price: "¥199" };
    const clean = posterObjects(theme, brief, "none");
    expect(posterObjects(theme, brief, "wrong_price").find((object) => object.id === "price").text).toBe("¥190");
    expect(posterObjects(theme, brief, "text_covered").map((object) => object.id)).toEqual([...clean.map((object) => object.id), "sticker"]);
    // The sticker is visible: not the background colour.
    expect(posterObjects(theme, brief, "text_covered").at(-1).color).not.toBe(theme.background);
    expect(posterObjects(theme, brief, "low_contrast").find((object) => object.id === "price").color).toBe(theme.faint);
    const clipped = posterObjects(theme, brief, "text_clipped").find((object) => object.id === "headline");
    expect(clipped.x + clipped.width).toBeGreaterThan(800);
    expect(clipped.x).toBe(posterObjects(theme, brief, "none").find((object) => object.id === "headline").x);
  });

  it("renders the posters with the engine at the size the rubric names", { timeout: 120_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "vlm-golden-"));
    try {
      // Two cases prove the render path, one of them drawn wider and cropped back.
      const labels = await buildGoldenSet(engine, directory, goldenCases().filter((item) => ["cream-text_covered", "cream-text_clipped"].includes(item.id)));
      expect(labels).toHaveLength(2);
      for (const label of labels) {
        const png = await readFile(label.png);
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([800, 1000]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("image VLM review rubric and scoring", () => {
  it("asks in two orders and reads answers strictly", () => {
    expect(rubricItems("reverse").map((item) => item.id)).toEqual([...DEFECTS].reverse());
    expect(rubricPrompt({ headline: "h", price: "¥1" }, "forward")).toContain('price "¥1"');
    expect(rubricHash()).toMatch(/^[a-f0-9]{16}$/u);
    const full = (overrides = {}) => JSON.stringify({ items: DEFECTS.map((id) => ({ id, verdict: overrides[id] ?? "ok", region: null })) });
    // Prose with braces around the answer still parses; the answer is the complete object.
    expect(parseAnswer(`Checking {headline} first.\n\`\`\`json\n${full({ seam: "problem" })}\n\`\`\``)).toMatchObject({ parsed: true, verdicts: { seam: "problem", wrong_price: "ok" } });
    // An answer missing a question, with an unknown verdict, or not about the rubric is unparsed.
    expect(parseAnswer('{"items":[{"id":"seam","verdict":"problem"}]}').parsed).toBe(false);
    expect(parseAnswer(full({ misaligned: "maybe" })).parsed).toBe(false);
    expect(parseAnswer('{"error":"cannot see image"}').parsed).toBe(false);
    expect(parseAnswer("no json here")).toMatchObject({ parsed: false, verdicts: { seam: "unsure" } });
  });

  it("counts a verdict only when both orders agree, and reports hits, false alarms and flips", () => {
    const verdicts = (problems) => Object.fromEntries(DEFECTS.map((id) => [id, problems.includes(id) ? "problem" : "ok"]));
    const answer = (caseId, defect, order, problems) => ({ model: "m", caseId, defect, order, parsed: true, verdicts: verdicts(problems) });
    const [score] = scoreAnswers([
      answer("a", "seam", "forward", ["seam"]), answer("a", "seam", "reverse", ["seam"]),
      answer("b", "seam", "forward", ["seam"]), answer("b", "seam", "reverse", []),
      answer("c", "none", "forward", ["misaligned"]), answer("c", "none", "reverse", ["misaligned"]),
      answer("d", "none", "forward", []), answer("d", "none", "reverse", []),
      { ...answer("e", "seam", "forward", ["seam"]), parsed: false }, answer("e", "seam", "reverse", ["seam"])
    ]);
    const seam = score.items.find((item) => item.id === "seam"), misaligned = score.items.find((item) => item.id === "misaligned");
    // e's unreadable side makes it unparsed: a miss, but not a flip.
    expect(seam).toMatchObject({ positives: 3, hitRate: 0.333, falseAlarmRate: 0, unstableRate: 0.25, noVerdict: 2 });
    // e has no verdict, so the false-alarm rates count only the posters that answered.
    expect(misaligned).toMatchObject({ positives: 0, hitRate: null, falseAlarmRate: 0.25 });
    expect(score).toMatchObject({ posters: 5, cleanFalseAlarmRate: 0.5, unparsed: 1, unparsedPosters: 1 });
    const report = renderReport({ date: "2026-10-11", runId: "r1", rubricHash: "abc", posters: 5, models: ["m"], scores: [score], spend: { run: 1.234, total: 5.5 } });
    expect(report).toContain("| `seam` | 3 | 33% | 0% | 25% | 2 |");
    expect(report).toContain("¥1.23 this run, ¥5.50 across all runs");
    expect(report).toContain("region) is not checked");
  });
});

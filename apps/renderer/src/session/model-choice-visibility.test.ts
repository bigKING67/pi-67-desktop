import { describe, expect, it } from "vitest";
import { visibleModelChoices } from "./model-choice-visibility.js";

const models = [
  { id: "deepseek-v4-flash" },
  { id: "deepseek-v4-pro" },
  { id: "deepseek-flash" },
  { id: "deepseek-v4-flash-vision-exp" }
];

describe("visibleModelChoices", () => {
  it("offers the canonical Flash and Pro without mutating Pi's catalog or source order", () => {
    const before = structuredClone(models);
    const visible = visibleModelChoices("deepseek", models, "deepseek-flash");
    expect(visible).toEqual([models[1], models[2]]);
    expect(visible[1]).toBe(models[2]);
    expect(models).toEqual(before);
  });

  it.each(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"])(
    "keeps the explicitly selected historical identity %s without switching it",
    (selected) => {
      expect(visibleModelChoices("deepseek", models, selected).map((model) => model.id))
        .toEqual(models.filter((model) => model.id === selected
          || model.id === "deepseek-flash" || model.id === "deepseek-v4-pro").map((model) => model.id));
    }
  );

  it("does not hide offline legacy choices if Pi has not supplied the replacement", () => {
    const offline = models.filter((model) => model.id !== "deepseek-flash");
    expect(visibleModelChoices("deepseek", offline, undefined)).toBe(offline);
  });

  it("does not apply an official Provider alias rule to a custom Provider", () => {
    expect(visibleModelChoices("custom-deepseek", models, undefined)).toBe(models);
  });
});

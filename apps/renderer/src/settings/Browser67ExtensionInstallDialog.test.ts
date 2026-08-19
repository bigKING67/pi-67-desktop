import { describe, expect, it } from "vitest";
import { browser67ExtensionNeedsPrepare } from "./Browser67ExtensionInstallDialog.js";

describe("browser67 extension install dialog state", () => {
  it("reuses current managed files for reload-required and connected states", () => {
    expect(browser67ExtensionNeedsPrepare("reload-required")).toBe(false);
    expect(browser67ExtensionNeedsPrepare("connected")).toBe(false);
    expect(browser67ExtensionNeedsPrepare("prepared")).toBe(false);
  });

  it("prepares files only when they are missing or failed", () => {
    expect(browser67ExtensionNeedsPrepare("not-prepared")).toBe(true);
    expect(browser67ExtensionNeedsPrepare("failed")).toBe(true);
  });
});

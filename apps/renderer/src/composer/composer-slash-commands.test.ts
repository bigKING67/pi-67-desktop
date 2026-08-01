import { describe, expect, it } from "vitest";
import { PI_DESKTOP_ACTIONS } from "../pi-actions/pi-desktop-actions.js";
import { buildComposerSlashCatalog } from "./use-composer-slash-catalog.js";
import {
  exactSlashCommand,
  filterSlashCommands,
  insertSlashCommand,
  isSlashInvocation,
  resolveSlashSubmission,
  slashInvocationFromDraft,
  slashQueryFromDraft
} from "./composer-slash-commands.js";

const CATALOG = {
  items: [
    ...PI_DESKTOP_ACTIONS,
    { name: "plan", source: "extension", description: "Create a plan" },
    { name: "review", source: "prompt", description: "Review changes" },
    { name: "skill:design-craft", source: "skill", description: "Frontend design" }
  ],
  total: PI_DESKTOP_ACTIONS.length + 3,
  truncated: false
} as const;

describe("Composer Slash commands", () => {
  it("only opens for the leading unfinished Slash token", () => {
    expect(slashQueryFromDraft("/")).toEqual({ leadingWhitespace: "", token: "" });
    expect(slashQueryFromDraft("  /pl")).toEqual({ leadingWhitespace: "  ", token: "pl" });
    expect(slashQueryFromDraft("hello /")).toBeUndefined();
    expect(slashQueryFromDraft("/plan now")).toBeUndefined();
  });

  it("ranks names ahead of descriptions and inserts without executing", () => {
    const query = slashQueryFromDraft("/pl")!;
    expect(filterSlashCommands(CATALOG, query).map((command) => command.name)).toEqual(["plan"]);
    expect(insertSlashCommand("/pl", CATALOG.items.find((command) => command.name === "plan")!))
      .toBe("/plan ");
  });

  it("keeps the four source groups in product order", () => {
    const query = slashQueryFromDraft("/")!;
    const sources = filterSlashCommands(CATALOG, query).map((command) => command.source);
    expect(sources.slice(0, PI_DESKTOP_ACTIONS.length)).toEqual(
      Array.from({ length: PI_DESKTOP_ACTIONS.length }, () => "desktop-action")
    );
    expect(sources.slice(PI_DESKTOP_ACTIONS.length)).toEqual(["extension", "prompt", "skill"]);
  });

  it("keeps Desktop builtins available and prevents runtime aliases from overriding reserved names", () => {
    const catalog = buildComposerSlashCatalog({
      items: [
        { name: "model", source: "extension", description: "runtime alias" },
        { name: "plan", source: "extension", description: "plan" }
      ],
      total: 2,
      truncated: false
    });

    expect(catalog.items.filter((command) => command.name === "model")).toEqual([
      expect.objectContaining({ source: "desktop-action" })
    ]);
    expect(catalog.items).toContainEqual(expect.objectContaining({ name: "plan", source: "extension" }));
    expect(buildComposerSlashCatalog().items).toHaveLength(PI_DESKTOP_ACTIONS.length);
  });

  it("resolves exact invocation source for submission routing", () => {
    expect(exactSlashCommand(" /plan ship it", CATALOG)?.source).toBe("extension");
    expect(exactSlashCommand("/skill:design-craft polish", CATALOG)?.source).toBe("skill");
    expect(exactSlashCommand("/unknown", CATALOG)).toBeUndefined();
    expect(isSlashInvocation(" /unknown value")).toBe(true);
    expect(isSlashInvocation("ordinary prompt")).toBe(false);
  });

  it("parses exact Desktop actions and preserves arguments for the native Controller", () => {
    expect(exactSlashCommand("/model", CATALOG)?.source).toBe("desktop-action");
    expect(slashInvocationFromDraft(" /compact keep decisions only ")).toEqual({
      name: "compact",
      arguments: "keep decisions only"
    });
  });

  it("routes Desktop actions and unsupported Pi TUI builtins without sending them as prompts", () => {
    expect(resolveSlashSubmission("/new", CATALOG)).toMatchObject({
      kind: "desktop-action",
      action: { name: "new" }
    });
    expect(resolveSlashSubmission("/compact keep decisions", CATALOG)).toMatchObject({
      kind: "desktop-action",
      action: { name: "compact" },
      arguments: "keep decisions"
    });
    expect(resolveSlashSubmission("/share", CATALOG)).toEqual({
      kind: "unsupported-pi-builtin",
      name: "share"
    });
    expect(resolveSlashSubmission("/unknown compatibility", CATALOG)).toEqual({ kind: "prompt" });
    expect(resolveSlashSubmission("/plan now", CATALOG)).toEqual({ kind: "extension", command: "plan now" });
  });
});

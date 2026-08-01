import type { SlashCommandCatalogResult } from "@pi67/protocol";
import { describe, expect, it } from "vitest";
import {
  exactSlashCommand,
  filterSlashCommands,
  insertSlashCommand,
  isSlashInvocation,
  slashQueryFromDraft
} from "./composer-slash-commands.js";

const CATALOG: SlashCommandCatalogResult = {
  items: [
    { name: "plan", source: "extension", description: "Create a plan" },
    { name: "review", source: "prompt", description: "Review changes" },
    { name: "skill:design-craft", source: "skill", description: "Frontend design" }
  ],
  total: 3,
  truncated: false
};

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
    expect(insertSlashCommand("/pl", CATALOG.items[0]!)).toBe("/plan ");
  });

  it("resolves exact invocation source for submission routing", () => {
    expect(exactSlashCommand(" /plan ship it", CATALOG)?.source).toBe("extension");
    expect(exactSlashCommand("/skill:design-craft polish", CATALOG)?.source).toBe("skill");
    expect(exactSlashCommand("/unknown", CATALOG)).toBeUndefined();
    expect(isSlashInvocation(" /unknown value")).toBe(true);
    expect(isSlashInvocation("ordinary prompt")).toBe(false);
  });
});

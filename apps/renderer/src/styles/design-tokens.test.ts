import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// A `var(--name)` with no fallback and no definition anywhere is invalid at
// computed time: the declaration silently drops (a check glyph inherits grey on
// the accent, a code font falls back to the UI face, a transition vanishes).
const source = new URL("..", import.meta.url).pathname;
/** Set at runtime by react-aria on popovers and menus. */
const RUNTIME = new Set(["--trigger-width", "--trigger-anchor-point"]);

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(?:css|tsx?)$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("design tokens", () => {
  it("every custom property a stylesheet reads without a fallback is defined somewhere", () => {
    const all = files(source).map((path) => ({ path, text: readFileSync(path, "utf8") }));
    const defined = new Set(RUNTIME);
    for (const { text } of all) {
      for (const match of text.matchAll(/(--[\w-]+)\s*:/gu)) defined.add(match[1]!);
      for (const match of text.matchAll(/["'](--[\w-]+)["']/gu)) defined.add(match[1]!);
    }
    const missing = all.filter(({ path }) => path.endsWith(".css")).flatMap(({ path, text }) =>
      [...text.matchAll(/var\((--[\w-]+)\s*\)/gu)].filter((match) => !defined.has(match[1]!)).map((match) => `${relative(source, path)}: ${match[1]}`));
    expect(missing).toEqual([]);
  });
});

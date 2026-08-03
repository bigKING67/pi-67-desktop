import { describe, expect, it } from "vitest";
import { parseBoundedShellCommand } from "./shell-command-parser.js";

describe("parseBoundedShellCommand", () => {
  it("tokenizes the bounded conjunction and pipeline grammar", () => {
    expect(parseBoundedShellCommand(
      "cd 'apps/renderer' && CI=1 pnpm test | head -n 20"
    )).toEqual({
      commands: [
        ["cd", "apps/renderer"],
        ["CI=1", "pnpm", "test"],
        ["head", "-n", "20"]
      ],
      operators: ["and", "pipe"]
    });
  });

  it("preserves quoted and escaped metacharacters as literal arguments", () => {
    expect(parseBoundedShellCommand("rg 'a && b; $HOME' docs")).toEqual({
      commands: [["rg", "a && b; $HOME", "docs"]],
      operators: []
    });
    expect(parseBoundedShellCommand('grep "a \\"quoted\\" value" README.md')).toEqual({
      commands: [["grep", 'a "quoted" value', "README.md"]],
      operators: []
    });
    expect(parseBoundedShellCommand("grep price\\>0 README.md")).toEqual({
      commands: [["grep", "price>0", "README.md"]],
      operators: []
    });
  });

  it("rejects empty, oversized, multiline, and unterminated commands", () => {
    for (const command of [
      "",
      " ",
      "a".repeat(4_097),
      "git status\ngit diff",
      "git status\rgit diff",
      "rg 'unterminated",
      'rg "unterminated',
      "rg trailing\\",
      'rg "trailing\\'
    ]) expect(parseBoundedShellCommand(command), command).toBeUndefined();
  });

  it("rejects expansion, redirection, unsupported operators, and empty segments", () => {
    for (const command of [
      "rg $HOME .",
      'rg "$HOME" .',
      "rg `pwd` .",
      'rg "`pwd`" .',
      "cat < input",
      "cat > output",
      "git status; git diff",
      "git status & git diff",
      "git status || git diff",
      "git status |& head",
      "&& git status",
      "| git status",
      "git status &&",
      "git status |",
      "(git status)",
      "echo $(pwd)"
    ]) expect(parseBoundedShellCommand(command), command).toBeUndefined();
  });
});

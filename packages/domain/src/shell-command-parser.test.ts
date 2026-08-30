import { describe, expect, it } from "vitest";
import { parseBoundedShellCommand } from "./shell-command-parser.js";

describe("parseBoundedShellCommand", () => {
  it("tokenizes the bounded conjunction, sequence, pipeline, and output-discard grammar", () => {
    expect(parseBoundedShellCommand(
      "cd 'apps/renderer' && CI=1 pnpm test 2>&1 | head -n 20; ls temp 2>/dev/null"
    )).toEqual({
      commands: [
        ["cd", "apps/renderer"],
        ["CI=1", "pnpm", "test"],
        ["head", "-n", "20"],
        ["ls", "temp"]
      ],
      operators: ["and", "pipe", "sequence"]
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

  it("keeps arbitrary redirection and malformed safe-looking variants out of the bounded grammar", () => {
    for (const command of [
      "cat 2>error.log",
      "cat 1>/dev/null",
      "cat >/dev/null",
      "cat 2> /dev/null",
      "cat2>&1",
      "cat 2>&10",
      "cat 2>/dev/null.txt",
      "git status;; git diff"
    ]) expect(parseBoundedShellCommand(command), command).toBeUndefined();
  });
});

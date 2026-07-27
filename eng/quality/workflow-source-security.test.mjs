import { describe, expect, it } from "vitest";
import {
  extractWorkflowRunBodies,
  extractWorkflowShellRunBodies
} from "./workflow-source-security.mjs";

const FIXTURE = `
jobs:
  verify:
    steps:
      - name: Bash step
        shell: bash
        run: echo safe
      - name: Parse PowerShell
        shell: pwsh
        env:
          EXPECTED: value
        run: |
          $value = $env:EXPECTED
          if (-not $value) {
            throw 'missing'
          }
      - name: Second PowerShell
        shell: pwsh
        run: Write-Output 'ready'
`;

describe("workflow source security helpers", () => {
  it("extracts every run body without consuming the following step", () => {
    expect(extractWorkflowRunBodies(FIXTURE)).toEqual([
      "echo safe",
      expect.stringContaining("$value = $env:EXPECTED"),
      "Write-Output 'ready'"
    ]);
  });

  it("extracts and dedents only the requested shell step bodies", () => {
    expect(extractWorkflowShellRunBodies(FIXTURE, "pwsh")).toEqual([
      {
        name: "Parse PowerShell",
        body: "$value = $env:EXPECTED\nif (-not $value) {\n  throw 'missing'\n}"
      },
      { name: "Second PowerShell", body: "Write-Output 'ready'" }
    ]);
  });
});

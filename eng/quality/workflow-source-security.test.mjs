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

  it("treats implicit and unnamed steps on Windows runners as PowerShell", () => {
    const source = `
defaults:
  run:
    shell: bash
jobs:
  windows:
    runs-on: windows-2025
    defaults:
      run:
        shell: pwsh
    steps:
      - uses: actions/checkout@v5
      - name: Implicit PowerShell
        run: Write-Output 'implicit'
      - run: Write-Output 'unnamed'
      - name: Explicit bash
        shell: bash
        run: echo bash
  windows-runner-default:
    runs-on: windows-2025
    steps:
      - name: Runner default
        run: |
          $ok = $true
  mac:
    runs-on: macos-15
    steps:
      - name: Workflow default bash
        run: echo mac
`;
    expect(extractWorkflowShellRunBodies(source, "pwsh")).toEqual([
      { name: "Implicit PowerShell", body: "Write-Output 'implicit'" },
      { name: "unnamed step at line 15", body: "Write-Output 'unnamed'" }
    ]);
    // Without a job default, the workflow-level bash default wins over the Windows runner default.
    expect(extractWorkflowShellRunBodies(source.replace(/^defaults:\n  run:\n    shell: bash\n/mu, ""), "pwsh")
      .map((script) => script.name)).toEqual(["Implicit PowerShell", "unnamed step at line 12", "Runner default"]);
  });
});


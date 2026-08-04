import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Windows installer certification workflow", () => {
  it("supports explicit non-release quick and full lifecycle dispatches", async () => {
    const workflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

    expect(workflow).toMatch(/workflow_dispatch:[\s\S]*?windows_installer_mode:/u);
    expect(workflow).toMatch(/windows_installer_mode:[\s\S]*?options:\s*- quick\s*- full/u);
    expect(workflow).toContain("DISPATCH_WINDOWS_INSTALLER_MODE: ${{ inputs.windows_installer_mode }}");
    expect(workflow).toContain("WINDOWS_INSTALLER_MODE: ${{ needs.change-scope.outputs.windows_installer_mode }}");
    expect(workflow).toContain('if [[ "$CI_EVENT_NAME" == "workflow_dispatch" ]]; then');
    expect(workflow).toContain('WINDOWS_INSTALLER_MODE="$DISPATCH_WINDOWS_INSTALLER_MODE"');
    expect(workflow).toContain("pnpm run package:smoke:windows-installer --quick");
    expect(workflow).toContain("pnpm run package:smoke:windows-installer\n");
  });
});

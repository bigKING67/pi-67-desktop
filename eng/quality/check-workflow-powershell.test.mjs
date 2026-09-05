import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("PowerShell workflow gate", () => {
  it("runs the AST parser inside the native Windows job", async () => {
    const workflow = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
    const nativeWindows = workflow.match(/\n  native-windows:[\s\S]*?\n  windows-installer-reuse:/u)?.[0] ?? "";

    expect(nativeWindows).toMatch(/name: Verify workflow and packaging PowerShell syntax\n\s+shell: pwsh\n\s+run: pnpm run check:workflow-powershell/u);
  });
});

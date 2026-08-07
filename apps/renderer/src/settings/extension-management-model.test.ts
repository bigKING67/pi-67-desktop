import type { ExtensionPackageEntry } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  buildPackageRows,
  filterPackageRows,
  inferSourceKind,
  packageResourceEnabled,
  packageRowAccessibleName,
  packageRowEnabled,
  packageRowState
} from "./extension-management-model.js";

describe("Extension management view model", () => {
  it("keeps bundled capabilities out while preserving project overrides and inherited packages", () => {
    const globalOverride = packageEntry("npm:overridden", "global", true);
    const projectOverride = packageEntry("npm:overridden", "project", false);
    const inherited = packageEntry("npm:inherited", "global", true);
    const bundled: ExtensionPackageEntry = {
      ...packageEntry("/managed/pi67-core", "global", true),
      origin: "first-party",
      sourceKind: "bundled"
    };

    const rows = buildPackageRows(
      [globalOverride, projectOverride, inherited, bundled],
      [{ source: inherited.source, scope: "global", type: "npm", displayName: "inherited" }],
      "project"
    );

    expect(rows.map((row) => row.key)).toEqual([
      "configured:npm:overridden",
      "configured:npm:inherited"
    ]);
    expect(rows[0]).toMatchObject({ kind: "configured", inherited: false, entry: projectOverride });
    expect(rows[1]).toMatchObject({ kind: "configured", inherited: true, entry: inherited });
    expect(rows[1]?.update?.displayName).toBe("inherited");
  });

  it("keeps resource filtering, search, state, and updates explicit", () => {
    const enabled = {
      ...packageEntry("npm:@example/alpha", "global", true),
      displayName: "Alpha Delegator",
      version: "1.2.3",
      description: "Coordinates delegated tasks."
    };
    const disabled = packageEntry("https://example.test/beta.git", "global", false);
    const skillOnly = { ...packageEntry("npm:skill-only", "global", true), resourceTypes: ["skill" as const] };
    const rows = buildPackageRows(
      [enabled, disabled, skillOnly],
      [{ source: disabled.source, scope: "global", type: "git", displayName: "beta" }],
      "global"
    );

    expect(rows).toHaveLength(3);
    expect(filterPackageRows(rows, "disabled", "").map((row) => row.key)).toEqual([
      "configured:https://example.test/beta.git"
    ]);
    expect(filterPackageRows(rows, "updates", "")).toHaveLength(1);
    expect(filterPackageRows(rows, "all", "ALPHA")).toHaveLength(1);
    expect(filterPackageRows(rows, "all", "delegated tasks")).toHaveLength(1);
    expect(rows.map(packageRowEnabled)).toEqual([true, false, true]);
    expect(packageRowAccessibleName(rows[0]!)).toContain("Alpha Delegator，npm:@example/alpha · 全局");
  });

  it("keeps a multi-resource package in one row with type-scoped states", () => {
    const mixed: ExtensionPackageEntry = {
      ...packageEntry("npm:pi-subagents", "global", true),
      resourceTypes: ["extension", "skill", "prompt"],
      resourceStates: [
        { type: "extension" as const, enabled: true },
        { type: "skill" as const, enabled: false },
        { type: "prompt" as const, enabled: true }
      ]
    };

    const rows = buildPackageRows([mixed], [], "global");

    expect(rows).toHaveLength(1);
    expect(packageRowState(rows[0]!)).toBe("partial");
    expect(packageResourceEnabled(mixed, "extension")).toBe(true);
    expect(packageResourceEnabled(mixed, "skill")).toBe(false);
  });

  it("does not present unverified or drifted packages as enabled", () => {
    const unverified = {
      ...packageEntry("npm:unverified", "global", true),
      trustState: "unverified" as const,
      trustReason: "receipt-missing" as const
    };
    const drifted = {
      ...packageEntry("npm:drifted", "global", true),
      trustState: "drifted" as const,
      trustReason: "content-hash-changed" as const
    };
    const rows = buildPackageRows([unverified, drifted], [], "global");

    expect(rows.map(packageRowState)).toEqual(["blocked", "blocked"]);
    expect(rows.map(packageRowEnabled)).toEqual([false, false]);
    expect(filterPackageRows(rows, "enabled", "")).toEqual([]);
  });

  it("recognizes npm, Git, POSIX paths, and Windows paths", () => {
    expect(inferSourceKind("npm:@scope/package")).toBe("npm");
    expect(inferSourceKind("https://example.test/repo.git")).toBe("git");
    expect(inferSourceKind("/Users/test/extension")).toBe("path");
    expect(inferSourceKind("C:\\Extensions\\local")).toBe("path");
  });
});

function packageEntry(
  source: string,
  scope: "global" | "project",
  enabled: boolean
): ExtensionPackageEntry {
  return {
    source,
    scope,
    enabled,
    filtered: false,
    installed: true,
    trustState: "user-installed-observed"
  };
}

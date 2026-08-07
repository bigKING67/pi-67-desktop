import { expect, type Page } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  recordedCommandDetails,
  setMockAgentResponseResult
} from "./pi67-renderer-fixture.js";

export interface PackageEntry {
  source: string;
  scope: "global" | "project";
  enabled: boolean;
  filtered: boolean;
  installed: boolean;
  trustState: "builtin-verified" | "known-baseline-observed" | "user-approved-observed"
    | "user-installed-observed" | "unverified" | "drifted" | "unavailable";
  trustReason?: "receipt-missing" | "install-content-missing" | "package-identity-changed" | "manifest-changed"
    | "directory-identity-changed" | "content-hash-changed" | "receipt-invalid" | "inspection-limited"
    | "mutation-ambiguous";
  trustObservedAt?: number;
  displayName?: string;
  version?: string;
  description?: string;
  resourceTypes?: Array<"extension" | "skill" | "prompt" | "theme">;
  resourceStates?: Array<{
    type: "extension" | "skill" | "prompt" | "theme";
    enabled: boolean;
  }>;
}

export async function openPackageSettings(page: Page, items: PackageEntry[]): Promise<void> {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await setMockAgentResponseResult(page, "extension.package.list", {
    items,
    total: items.length
  });
  await page.getByRole("button", { name: "帮助与设置" }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "扩展", exact: true }).click();
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).filter((command) => command.type === "extension.package.list").length).toBeGreaterThan(0);
}

export function packageEntry(
  source: string,
  scope: "global" | "project",
  enabled = true,
  metadata: Pick<PackageEntry, "displayName" | "version" | "description" | "resourceTypes" | "resourceStates"> = {}
): PackageEntry {
  return {
    source,
    scope,
    enabled,
    filtered: false,
    installed: true,
    trustState: "user-installed-observed",
    ...metadata
  };
}

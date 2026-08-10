import type { Page } from "@playwright/test";
import { MOCK_EXTENSION_COMMANDS } from "./pi67-extension-catalog-fixture.js";
import { MOCK_SESSION_CATALOG_STATUS } from "./pi67-session-catalog-fixture.js";
import { installMockSessionControlCommandHandler } from "./pi67-renderer-snapshot-fixture.js";
import { installMockAssetReadHandler } from "./pi67-renderer-asset-fixture.js";
import { installMockCommandResponseHandler } from "./pi67-renderer-command-fixture.js";
import { installMockSessionRotationHandler } from "./pi67-renderer-session-fixture.js";
import { installMockContextFileCommandHandler } from "./pi67-context-file-fixture.js";
import { installMockInspectorCommandHandler } from "./pi67-renderer-inspector-command-fixture.js";
import { installMockLarkCommandHandler } from "./pi67-lark-command-fixture.js";
import { installMockProviderConfigurationCommandHandler } from "./pi67-provider-configuration-command-fixture.js";
import { installMockPayloadSanitizer } from "./pi67-renderer-payload-sanitizer.js";
import { installMockOperationFactories } from "./pi67-renderer-operation-fixture.js";
import { MOCK_RUNTIME_DIAGNOSTICS } from "./pi67-runtime-diagnostics-fixture.js";

export async function installMockAgentHandlers(page: Page): Promise<void> {
  await page.evaluate(installMockSessionControlCommandHandler);
  await page.evaluate(installMockAssetReadHandler);
  await page.evaluate(installMockSessionRotationHandler);
  await page.evaluate(installMockPayloadSanitizer);
  await page.evaluate(installMockOperationFactories);
  await page.evaluate(installMockContextFileCommandHandler);
  await page.evaluate(installMockInspectorCommandHandler);
  await page.evaluate(installMockLarkCommandHandler);
  await page.evaluate(installMockProviderConfigurationCommandHandler);
  await page.evaluate<void, Parameters<typeof installMockCommandResponseHandler>[0]>(installMockCommandResponseHandler, {
    fixtureExtensionCommands: MOCK_EXTENSION_COMMANDS,
    fixtureRuntimeDiagnostics: MOCK_RUNTIME_DIAGNOSTICS,
    fixtureSessionCatalogStatus: MOCK_SESSION_CATALOG_STATUS
  });
}

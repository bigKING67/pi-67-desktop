import {
  PROTOCOL_REVISION,
  PROTOCOL_VERSION
} from "../../packages/protocol/src/index.js";
import {
  MOCK_EXTENSION_CATALOG,
  MOCK_RUNTIME_CAPABILITIES
} from "./pi67-extension-catalog-fixture.js";
import { createMockContextFiles } from "./pi67-context-file-fixture.js";
import { createMockProviderConfigurationSnapshot } from "./pi67-provider-configuration-snapshot-fixture.js";
import { createMockSessionSnapshot } from "./pi67-renderer-snapshot-fixture.js";
import { mockSessionCatalogPage } from "./pi67-session-catalog-fixture.js";
import type { FixtureMessage, MockAgentOptions } from "./pi67-renderer-fixture-types.js";

export function createMockAgentFixtureInput(
  messages: FixtureMessage[],
  responseDelays: Record<string, number>,
  options: MockAgentOptions
) {
  return {
    fixtureMessages: messages,
    fixtureResponseDelays: responseDelays,
    fixtureOptions: options,
    fixtureExtensionCatalog: MOCK_EXTENSION_CATALOG,
    fixtureRuntimeCapabilities: MOCK_RUNTIME_CAPABILITIES,
    fixtureProviderConfiguration: options.providerConfigurationSnapshot
      ?? createMockProviderConfigurationSnapshot(),
    fixtureContextFiles: createMockContextFiles(),
    fixtureSessionCatalogPage: mockSessionCatalogPage(options.sessionCatalogItems ?? []),
    fixtureSessionCatalogPagesByWorkspace: Object.fromEntries(
      Object.entries(options.sessionCatalogItemsByWorkspace ?? {}).map(([workspaceId, items]) => (
        [workspaceId, mockSessionCatalogPage(items)]
      ))
    ),
    fixtureSnapshot: createMockSessionSnapshot(messages),
    fixtureProtocolVersion: PROTOCOL_VERSION,
    fixtureProtocolRevision: PROTOCOL_REVISION
  };
}

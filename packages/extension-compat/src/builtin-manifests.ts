import { createExtensionAdapterConformanceInventory } from "./conformance.js";

// Every built-in must pair its manifest with pinned source and observed-surface evidence.
export const BUILTIN_EXTENSION_ADAPTER_CONFORMANCE = createExtensionAdapterConformanceInventory([{
  manifest: {
    schemaVersion: 1,
    id: "pi-rewind-0.5.0",
    package: "pi-rewind",
    versionRange: "0.5.0",
    commands: {
      rewind: {
        label: "Rewind",
        description: "Restore files and/or conversation to a checkpoint."
      }
    },
    tools: {}
  },
  evidence: {
    schemaVersion: 2,
    adapterId: "pi-rewind-0.5.0",
    package: "pi-rewind",
    installedVersion: "0.5.0",
    packageIntegrity: "sha512-nW6HVg3II7+DhMZAsUX7EJPT2/IgPGXWGDntppS1cyYLfNaVgeBU5bRW7e1acHk1LW18EWdMh6475CRh0PAnGQ==",
    license: "MIT",
    sourceRepository: "https://github.com/arpagon/pi-rewind",
    sourceCommit: "91611ad87992fb7b635a41ba68f67916ff6e6ae3",
    sourcePaths: ["src/index.ts", "src/commands.ts"],
    commands: ["rewind"],
    tools: []
  }
}, {
  manifest: {
    schemaVersion: 1,
    id: "feniix-pi-sequential-thinking-5.0.3",
    package: "@feniix/pi-sequential-thinking",
    versionRange: "5.0.3",
    commands: {},
    tools: {
      process_thought: { presentation: "generic", label: "Process Thought" },
      generate_summary: { presentation: "read", label: "Generate Thinking Summary" },
      clear_history: { presentation: "generic", label: "Clear Thought History" },
      export_session: { presentation: "generic", label: "Export Thinking Session" },
      import_session: { presentation: "generic", label: "Import Thinking Session" },
      get_thinking_history: { presentation: "read", label: "Get Thinking History" },
      get_thinking_status: { presentation: "read", label: "Get Thinking Status" },
      sequential_think: { presentation: "generic", label: "Sequential Thinking" }
    }
  },
  evidence: {
    schemaVersion: 2,
    adapterId: "feniix-pi-sequential-thinking-5.0.3",
    package: "@feniix/pi-sequential-thinking",
    installedVersion: "5.0.3",
    packageIntegrity: "sha512-ADyAMziivVPLBthAZoUiMHiFk31m4MkAx3bj5kZS6YGg4D4QBxrzg9t6Kr4lCp2vVTNoHLJx+z0QN7jJzjK+cQ==",
    license: "MIT",
    sourceRepository: "https://github.com/feniix/pi-extensions",
    sourceCommit: "36cf6ac5497b8cb75c7c7a34afe78c14b3584a61",
    sourcePaths: [
      "packages/pi-sequential-thinking/extensions/index.ts",
      "packages/pi-sequential-thinking/extensions/tools.ts"
    ],
    commands: [],
    tools: [
      "process_thought",
      "generate_summary",
      "clear_history",
      "export_session",
      "import_session",
      "get_thinking_history",
      "get_thinking_status",
      "sequential_think"
    ]
  }
}]);
export const BUILTIN_EXTENSION_ADAPTER_MANIFESTS = BUILTIN_EXTENSION_ADAPTER_CONFORMANCE.manifests;

# Change: Add the native Windows Pi-67 Desktop client

## Why

Pi and pi-67 currently provide a capable TUI, but beginner users need a native
Windows workflow for installation, configuration, sessions, tool approvals,
diagnostics, and updates. Peak Code demonstrates a useful product shape but its
Electron shell and embedded old Pi SDK do not satisfy the runtime, performance,
or compatibility boundaries.

## What Changes

- Add a new C#/.NET 10 WinUI 3 Windows x64 application.
- Use the user's real `pi --mode rpc` process as the sole execution runtime.
- Reuse Pi configuration, project trust, extensions, and session persistence.
- Add individually confirmed Windows environment onboarding.
- Add native transcript, tool, diff, project, settings, and diagnostic surfaces.
- Add a Desktop-only Pi safety extension.
- Add WiX Burn/MSI packaging, compatibility manifests, CI, performance gates,
  SBOM, provenance, and an independent release lifecycle.
- Defer Rust behind a measured performance adoption gate.

## Impact

- Affected specs: pi-runtime, windows-onboarding, native-client, desktop-release.
- Affected code: new repository and all initial application layers.
- External state: no existing Pi credential, trust, or session format is
  migrated or rewritten.

## Approval

The user approved the architecture plan and explicitly requested implementation
on 2026-07-22.

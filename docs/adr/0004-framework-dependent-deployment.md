# ADR 0004: Framework-dependent deployment with Burn prerequisites

- Status: Accepted
- Date: 2026-07-22

## Decision

The application is framework-dependent for .NET 10 Desktop and Windows App SDK
2.3.1. WiX Burn installs a hash-verified official .NET Desktop Runtime and the
Microsoft-signed x64 Windows App Runtime MSIX payloads before the MSI.

The MSI installs only Desktop-owned files under Program Files and a Start menu
shortcut. Uninstall does not remove shared runtimes or user Pi data.

## Consequences

- Setup is smaller than a fully self-contained application payload.
- The Burn chain, MSI lifecycle, prerequisite no-op behavior, and repair path
  require controlled Windows VM replay before release.
- Build-time prerequisite URLs and hashes are reviewed as compatibility data.

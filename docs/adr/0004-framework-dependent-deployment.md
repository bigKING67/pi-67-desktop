# ADR 0004: Framework-dependent deployment with Burn prerequisites

- Status: Accepted
- Date: 2026-07-22

## Decision

The application is framework-dependent for .NET 10 Desktop and Windows App SDK
2.3.1. WiX Burn installs a hash-verified official .NET Desktop Runtime and the
Microsoft-signed x64 Windows App Runtime MSIX payloads before the MSI.

Burn uses the WiX NetFx `DotNetCoreSearch` to find the highest installed x64
.NET Desktop 10 runtime. The .NET runtime package runs only when that version is
older than 10.0.0. The Windows App Runtime package deliberately has no Burn
detection condition: its permanent bootstrap executable runs on every install
or repair and treats an existing same or newer Microsoft-signed MSIX package as
success. This keeps prerequisite repair deterministic without relying on a
brittle per-user package registration search.

WixStandardBootstrapperApplication owns setup UI. The MSI does not opt into
internal UI, so Burn supplies the external UI handler and the MSI remains
silent inside the bundle.

The MSI installs only Desktop-owned files under Program Files and a Start menu
shortcut. Uninstall does not remove shared runtimes or user Pi data.

## Consequences

- Setup is smaller than a fully self-contained application payload.
- Re-running setup replays the idempotent Windows App Runtime bootstrap before
  the MSI; the shared runtime remains permanent when the application is
  uninstalled.
- The Burn chain, MSI lifecycle, prerequisite no-op behavior, and repair path
  require controlled Windows VM replay before release.
- Build-time prerequisite URLs and hashes are reviewed as compatibility data.

# ADR 0005: WiX Toolset 5 for MSI and Burn

- Status: Accepted
- Date: 2026-07-22

## Decision

Installer projects pin WiX Toolset 5.0.2. WiX 6 introduced an Open Source
Maintenance Fee and WiX 7 enforces EULA acceptance during builds. The project
does not silently accept a fee-bearing EULA or impose that decision on
contributors or CI operators.

## Consequences

- The project will monitor WiX 5 security support and reassess the toolchain
  before it becomes unsupported.
- Upgrading to WiX 6 or later requires an explicit legal, cost, CI, and
  maintenance ADR rather than a routine dependency bump.

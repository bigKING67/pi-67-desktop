# ADR 0002: Real Pi is the only agent runtime

- Status: Accepted
- Date: 2026-07-22

## Decision

All agent turns run through the user's installed Pi package in RPC mode. The
Pi JSONL session file is canonical. SQLite contains only disposable indexes and
projections. The Node control bridge dynamically imports the same installed Pi
package for auth, model, settings, and trust operations.

## Consequences

- GUI and TUI sessions remain interoperable without translation.
- Pi installation and Desktop installation have independent lifecycles.
- A missing or incompatible Pi runtime is surfaced truthfully; there is no
  embedded fallback SDK.

# Implementation Plan

## 1. Planning and configuration

- Rewrite the repository authority boundary for L0/L1/L2 Native/Channel/Relay routing.
- Set safe explicit Trellis defaults and correct invalid package configuration.
- Record canonical developer alias policy and close the obsolete bootstrap task without automatic commit.

## 2. Relay core

- Implement `trellis_relay.py`, event validation/reduction, Task resolution, status-neutral attach and bounded Handoff validation.
- Wire idempotent `ensure`, `release`, and `close` into Task lifecycle hooks.
- Keep Durable Relay and Ephemeral Worker channels separate.

## 3. Platform entrypoints

- Update shared/Codex, Claude, Pi and Grok Continue instructions to call the Relay CLI.
- Add independent-review mode and exact Task-path fallback.
- Add project-local ignored Claude `bypassPermissions` configuration.
- Keep platform-native sub-agents as the default implementation path.

## 4. Engineering gates

- Add Python standard-library unit tests for Relay behavior.
- Add a deterministic static integration checker and package/CI command.
- Replace placeholder-only Spec noise with a thin authority map only where needed for this workflow.
- Validate Trellis 0.6.15 CLI flags and Worker permission arguments.

## 5. Validation

- Run syntax/config/task/Relay unit checks.
- Run Same-CLI Channel Check Smoke with bounded harmless scope.
- Run Codex -> Claude -> Pi -> Grok sequential Relay Smoke within USD 3 or record exact blockers.
- Run targeted repository checks, then one full `pnpm run check`.
- Re-read the final scoped diff and ensure no unknown WIP was overwritten.

## Rollback points

- Before Task lifecycle hooks: Relay CLI is manually callable only.
- Before platform entry updates: existing Trellis Continue behavior remains usable.
- Before CI integration: local checks can run without changing product CI.
- No step commits or pushes automatically.

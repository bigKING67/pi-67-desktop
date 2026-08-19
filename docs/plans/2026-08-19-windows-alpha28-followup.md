# Windows Alpha.28 follow-up

Status: active
Owner: Codex
Started: 2026-08-19
Last updated: 2026-08-19

## Goal

Resolve the issues observed on the Alpha.27 Windows x64 candidate without
weakening Pi-67 capability identity or renderer isolation contracts:

1. Expose the managed `tmwd_browser` server as direct Pi tools.
2. Prevent corrupted provider/model display names from reaching the composer.
3. Remove duplicate initial Pi `ModelRuntime` construction from session startup.
4. Reuse a current browser67 extension installation and reload it before asking
   the operator to replace the extension source.
5. Route Lark CLI installs through the configured npm source fallback, pin the
   checked target version, and never replace a newer user-global installation
   with an older channel or bundled version.
6. Prove Desktop and Pi TUI use the same Pi Agent Profile and keep user-owned
   model, auth, settings, Skill, and Package state across Desktop upgrades.
7. Explain model-specific thinking levels as the exact Pi SDK capability list
   instead of implying that Desktop owns or truncates the choices.
8. Upgrade the embedded Pi SDK packages from `0.83.0` to `0.84.2`, adapt all
   breaking runtime contracts, and ship one exact-source Alpha.28 internal
   candidate set for Windows x64 and macOS arm64.

## Non-goals

- Do not replace the embedded Pi SDK with the system `pi` executable or add a
  second runtime/session authority.
- Do not mutate or auto-upgrade a user's separately installed Pi TUI.
- Do not create a stable Tag, GitHub Release, signed build, notarization, or
  promotion. This delivery stops at the internal Feishu candidate mirror.

## Acceptance

- Managed `mcp.json` contains `directTools: true` for `tmwd_browser`; a prior
  Desktop receipt is migrated and its MCP cache entry is invalidated.
- Known-good UTF-8 model names remain unchanged, while corrupted names fall back
  to deterministic labels derived from the provider/model identity.
- Concurrent first Provider projection and task startup share one bounded
  `ModelRuntime` load; a timed-out load remains retryable.
- Current managed browser67 files do not trigger an install loop. Live identity
  mismatch first attempts an in-place extension reload and only then explains
  when the loaded source must be replaced.
- Lark CLI update uses the configured npm source policy with automatic mirror
  to official fallback, surfaces a bounded actionable failure, installs the
  exact checked target, and rejects staged downgrades before activation.
- A local Lark CLI newer than the checked channel is reported as current and is
  not downgraded. Desktop startup and application reinstall do not mutate the
  user-global Lark CLI or global Skills; only an explicit Skill update does.
- Desktop and Pi TUI resolve the same `~/.pi/agent` Profile (or the same explicit
  `PI_CODING_AGENT_DIR`) and Desktop capability bootstrap preserves user-owned
  configuration on both install orders.
- The composer renders exactly `AgentSession.getAvailableThinkingLevels()` and
  identifies those choices as current-model Pi SDK capability declarations.
- All four Pi SDK workspace overrides and three runtime dependencies resolve
  exactly to `0.84.2`; the frozen lockfile contains no runtime `0.83.0` entry.
- DeepSeek V4 Flash exposes the SDK-declared `off`, `low`, `high`, and `max`
  levels without hard-coded renderer choices.
- Targeted tests, type-check, build, packaged smoke, and the macOS unsigned
  preview gate pass locally. Windows behavior remains pending real Windows x64
  candidate verification.

## Delivery boundary

- Local implementation, scoped commit, push, Windows/macOS candidate builds,
  Feishu upload, and superseded Feishu candidate cleanup: authorized by the
  user on 2026-08-19.
- Stable Tag, GitHub Release, signing, notarization, and promotion: not
  authorized.

## Current evidence

| State | Evidence | Verified at |
| --- | --- | --- |
| OBSERVED | `main` equals `origin/main` at `ca86d77` before the Alpha.28 commit; all current dirty paths belong to the accumulated Alpha.28 follow-up. | 2026-08-19 |
| OBSERVED | Desktop embeds `@earendil-works/pi-coding-agent`; workspace overrides and runtime dependencies were pinned to `0.83.0`. | 2026-08-19 |
| OBSERVED | The four current stable Pi packages are published at `0.84.2`; the release contains breaking runtime API changes from `0.84.0`. | 2026-08-19 |
| OBSERVED | Pi AI `0.84.2` declares DeepSeek V4 Flash `low`, `high`, and `max` mappings; `off` remains the Desktop/Session opt-out. | 2026-08-19 |
| VERIFIED | All four workspace overrides and all three direct runtime dependencies resolve to `0.84.2`; the frozen lockfile and current runtime manifests contain no `0.83.0` dependency. | 2026-08-19 |
| VERIFIED | The full source gate passed with 576 test files, 2,966 passed tests and 3 intentional skips; type-check, lint, architecture, dead-code, reference, structure, transport and workflow gates also passed. | 2026-08-19 |
| VERIFIED | Unsigned macOS arm64 packaging and packaged Electron smoke passed, and the current app artifact was opened from this checkout. | 2026-08-19 |
| VERIFIED | Packaged browser67 live smoke resolved source-locked browser67 `0.4.0`, 18 healthy `tmwd_browser` tools and 60 ready `js-reverse` tools. | 2026-08-19 |

## Checkpoints

- [x] Direct browser tools and migration tests
- [x] Model label repair and runtime-load coalescing
- [x] Browser extension idempotent reload and UI states
- [x] Lark CLI source fallback, exact-target update, and downgrade protection
- [x] Shared Pi Profile and model-thinking capability contracts
- [x] Product/design contracts and release-gate verification
- [x] Upgrade Pi SDK packages, adapt breaking APIs, and add regression coverage
- [x] Complete targeted, full-source, packaged, and macOS preview gates
- [ ] Commit and push exact Alpha.28 source, then build and verify both platform candidates
- [ ] Upload the three current products, verify mirror identity, then remove superseded Feishu candidates

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | dependency/version inspection, `git diff --check`, architecture and dependency gates | exact `0.84.2`, Alpha.28, no stale runtime dependency | passed locally |
| Tests | targeted Pi/runtime/host/renderer tests, then `corepack pnpm run check` | final exit code and test counts | 576 files; 2,966 passed; 3 skipped |
| Runtime/host | Pi configuration, session create/resume, streaming, tool calls, Browser67 live smoke | current SDK behavior and exact Tool identity | packaged smoke and browser67 live smoke passed on macOS arm64 |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned`, hosted Windows candidate workflow | exact Alpha.28 source SHA and artifact identities | macOS local gate passed; exact committed rebuild and Windows candidate pending |
| Target OS/manual | user downloads exact Windows x64 EXE from Feishu | fresh/existing Profile acceptance | pending after upload |

## Rollback

Revert only the scoped Alpha.28 implementation commit if Windows verification
regresses. Restore the exact `0.83.0` dependency pins and frozen lockfile as one
unit if the SDK migration cannot satisfy source and packaged gates. Existing
user-owned Pi Profile files, MCP entries, global Skills, Lark CLI, and browser
profiles are never rewritten by this plan.

## Risks and unknowns

- Pi `0.84.0` changed `ModelRuntime` auth/refresh and streaming event contracts;
  compilation alone is insufficient, so session/event regression tests are
  required.
- Hosted Windows evidence does not replace the user's real Windows x64 install
  test against the downloaded Feishu bytes.
- Feishu destination state must be resolved from operator configuration or
  existing authenticated metadata; no folder token or credential enters Git.

## Progress log

- 2026-08-19: User authorized the Pi SDK `0.83.0` to `0.84.2` migration,
  Alpha.28 commit/push, candidate construction, Feishu upload, and removal of
  superseded candidate files after replacement verification.

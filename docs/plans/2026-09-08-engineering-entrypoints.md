# Engineering entrypoints and generated-output boundaries

## Goal and acceptance

Consolidate the existing engineering entrypoint, describe the actual validation matrix and
configuration ownership, inventory command/workflow roles, and fix verified declaration output
leaking into source directories. Preserve all test thresholds, platform evidence requirements,
unknown-diff fallback, and release authorization boundaries.

## Scope and delivery boundary

Local implementation, validation and the subsequently authorized scoped commit; no push,
workflow dispatch, publication or repository-wide workflow scaffold. Preserve unrelated prompt-attachment-access.test.ts WIP.
Existing untracked protocol declarations are evidence; inspect and retain exact copies before
any targeted cleanup. Do not introduce a second checkout.

## Decisions

- CONTRIBUTING.md is the engineering entrypoint; existing testing/release documents own details.
- AGENTS.md routes to authority rather than duplicating operational configuration.
- Commands remain separate when prerequisites, side effects or evidence differ.
- Generated source pollution must be fixed at emission; ignore patterns are not the fix.

## Checkpoints

- [x] Inventory scripts/configuration/workflow ownership and document validated routing.
- [x] Reproduce declaration emission and implement the smallest output-boundary correction.
- [x] Verify build outputs, unchanged source boundary and full source-quality gates.

## Rollback and evidence

Revert only task-owned changes if needed, preserving unrelated WIP and retained emission evidence.
Use targeted build checks followed by check:source; record results and unresolved limits here.

## Verified checkpoints

- Root script families and ten workflow roles are documented in the existing CI contract;
  no entry was proven obsolete, so no operator command was removed.
- Declaration reproduction: protocol alone produced no source outputs; package build produced
  23 protocol declarations; sequential package isolation identified runtime (4 declarations).
  Exact initial copies and hashes retained in `/tmp/pi67-declaration-emission-evidence/`.
- Runtime build now uses a repository-root tsconfig with the same compiler options and the
  same 285 source inputs. Public type exports and normal typecheck remain unchanged.
- Full `build` passed with no protocol source declarations (`/tmp/pi67-governance-build.log`).
- Existing structure gate rejects a known leaked declaration; current handwritten ambient
  declarations remain admitted (`/tmp/pi67-output-boundary-negative.log`).
- Independent review found no blocking issues; classifier/gate regressions: 30 passed.
- Full `check:source` passed (exit 0): 3704 tests passed, 5 skipped; coverage gates passed.
  Evidence: `/tmp/pi67-governance-full-check.log`.

## Closeout

Local implementation and validation complete; scoped commit authorized at closeout. No push or
dispatch performed. No generated
protocol declarations remain; original unrelated prompt-attachment-access.test.ts WIP is preserved.
No coverage, timeout, CI job-selection or release authorization rule was relaxed. Remote Windows
build behavior is not claimed from this macOS source/build verification.

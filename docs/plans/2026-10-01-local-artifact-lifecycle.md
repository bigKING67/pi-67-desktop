# Local artifact lifecycle

Status: completed
Owner: Codex
Started: 2026-10-01
Last updated: 2026-10-01

## Goal

Bound local installer copies across packaging, verified promotion and R2 staging.
Keep the current verified installer set and one previous successful version;
retire consumed copies only after checking their retained replacement bytes.

## Non-goals

No application/runtime change, remote operation, dependency change, automatic
historical evidence deletion, or adoption of unknown output directories.
Native runtime purposes, pins and existing retention remain unchanged.

## Acceptance criteria

- Release selection counts the current verified version across directories.
- Successful promotion preserves the previous verified bytes and evidence before replacement.
- Consumed installer copies and admitted Windows unpacked inputs are reclaimed.
- R2 local product copies are reclaimed only after publication and receipt persistence.
- Failure, pins, active use, symlinks, identity drift and concurrent producers fail closed.
- Repeated synthetic production/promotion cycles have bounded installer sets.

## Delivery boundary

- Local implementation: release tooling, contracts and regression tests.
- Commit: user subsequently authorized one scoped local commit of the 13 task files.
- Push/candidate/upload/tag/release/promotion: not authorized in this task.
- Live artifacts: read-only verification; no new blanket cleanup of existing outputs.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Cleanup reduced artifacts from 11.95 GB to 6.53 GB | ignored cleanup receipt | 2026-10-01 |
| OBSERVED | Packaging retention scans only release top-level archives; staging uses copies | existing release scripts | 2026-10-01 |
| OBSERVED AT START | main ahead of origin/main by 17; unrelated server.mjs WIP | initial Git audit | 2026-10-01 |

## Affected boundaries

- Modules/processes: eng/release and packaging retention consumers.
- Protocol/persisted state: existing artifact identity/manifest/receipt contracts only.
- Platform: portable local filesystem tooling; no Windows host certification.
- Security: exact known roots, shared archive lock, pins, open-file probes and replacement hashes.
- Existing WIP at entry: eng/evals/openviking-recall-baseline/server.mjs; preserve.
  Concurrent changes outside this task were not edited or reverted.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Reuse existing retention and provenance; preserve previous verified files in release | Avoid a second archive service or mutable identity index | Existing provenance cannot safely express ownership |
| No timer or age-based deletion of historical evidence | Age does not establish completion or ownership | A separately accepted evidence policy with exact migration scope |
| Reclaim R2 copies after writing successful publication receipt | Preserve retries and distinguish remote success from local cleanup failure | Publication contract changes |

## Checkpoints

- [x] 1. Inspect producer/consumer and retention contracts.
- [x] 2. Implement version selection, verified handoff and local copy retirement.
- [x] 3. Add failure/protection/repeated-cycle regressions and pass relevant gates.
- [x] 4. Read-only live plan and closeout.

## Validation matrix

| Layer | Command or procedure | Result |
| --- | --- | --- |
| Targeted tests | Six Vitest release/retention/promotion/packaging files, fixed 2 workers | PASS: 53 tests |
| Source quality | corepack pnpm run check:source (complete check, fixed 2 workers) | PASS: 905 test files and 5,945 tests passed; 9 files/24 tests skipped by existing configuration; coverage thresholds passed |
| Live filesystem | release:local:copies; release:local:retain; git diff --check | PASS: zero eligible bytes; current alpha.42; seven archives retained; different-byte macOS DMG/ZIP preserved; no live apply |
| Native packaging/Windows/R2 | Not performed; no external or packaging operation needed | UNVERIFIED |

## Rollback

Revert only this task's tooling/docs diff before commit; preserve unrelated WIP.
Automatic local retirement cannot restore deleted exact copies; retained replacement
hashes and previous successful versions are therefore required before deleting.

## Risks and unknowns

Legacy different-byte copies and unknown outputs remain protected. Capacity is
bounded for admitted generated installer sets, not all possible checkout writes.

## Progress log

- 2026-10-01: User accepted the lifecycle strategy; implementing its two priority items.
- 2026-10-01: Added staged admission/activation, shared producer lock, previous-version
  installer/evidence preservation, exact-copy retirement and publication-receipt ordering.
  Six-cycle and failure/pin/active-use/symlink/drift regressions passed; full source gate passed.
- 2026-10-01: User explicitly authorized a scoped local commit of the 13 task files;
  build output and artifacts remain excluded, with no push or distribution authorization.
- 2026-10-01: Pre-commit review replaced a hard-coded slash prefix with the native
  dirname comparison for protecting unpublished R2 copies on both supported hosts.
  The existing unpublished-copy regression and complete source gate were rerun.

## Closeout

Both accepted priority rules are implemented and validated in local release tooling.
Default promotion now preserves the previous admitted installer set and its evidence,
then retires exact consumed copies within the shared lock. Default R2 publication
retires only matching local product copies after the successful publication receipt.
Staged preparation preserves previous inputs on failure and refuses unknown/pinned/unsafe
members. Independent live dry runs reported zero eligible bytes and did not delete artifacts.

The canonical root checkout remains the intended workspace. The user authorized a scoped
local commit of the 13 task files; Git owns the resulting commit identity. No build candidate,
native packaging, real Windows test, upload, push or remote publication was performed for this task.
Historical screenshots/logs, unknown outputs and native-runtime lifecycle are outside
these two rules; this is not a total artifact byte cap or an age-based evidence policy.

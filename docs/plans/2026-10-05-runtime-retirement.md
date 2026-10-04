# Verified OpenViking runtime retirement

Status: source and bounded isolated packaged acceptance completed

## Goal and boundary
Retire obsolete installed runtime payloads independently by purpose only after actual
successful private startup, verified indexing, or verified query completion.
Source/tests plus explicitly authorized local candidate and isolated packaged acceptance;
no commit/push/deployment or real-profile destructive test.
Preserve existing dirty renderer/runtime WIP and product/architecture edits.

## Decisions
Keep signed manifest/signature plus a small retirement receipt in old installation
roots. Delete only their `runtime` payload. A pending receipt binds directory inode,
current admitted tree and signed old manifest; next successful use resumes partial
payload deletion. No ordinary startup sweep, downloads, data migration or model calls.
The application single-instance lifecycle owns this operation; operations are serialized
within the retirement controller. External non-cooperating filesystem writers remain
outside the trusted owner-controlled storage contract. Occupancy checks fail closed.

## Acceptance
- [x] Purpose-isolated success hooks; failure/admission alone never requests retirement.
- [x] Exact older-version names, signed identities, canonical owned paths and occupancy.
- [x] Busy/failure diagnostics do not change successful business results; later success retries.
- [x] Interrupted payload removal resumes using bounded metadata; unknown/replaced paths protected.
- [x] Targeted tests, typecheck and applicable source gate; evidence limits recorded.

## Rollback
Revert only this task's source additions. Removed runtime bytes require reinstallation;
receipts are not full backups. Never remove data/settings/team-projections. Do not run
packaged destructive tests against the user's profile. Windows unsupported/fail closed.

## Implementation and evidence

- Main composition owns one retirement controller and joins its shutdown. Real
  success callbacks originate in private native startup/scope provisioning, index
  verified output, and query current-result checks; preparation alone does nothing.
- Per-purpose pending work is coalesced and serialized. Signature/tree checks bind
  replacement and old runtime, and replacement/occupancy/target identities are
  checked again before deleting only the old payload. Metadata uses the existing
  no-follow, bounded, identity-checked reader.
- `retirement.json` stays immutable; a missing payload means completion. Pending
  payload deletion resumes only for the same replacement tree and old root inode.
  A later incompatible replacement or corrupted journal defers for manual review.
- Targeted seven-file run: 147 tests passed, including real macOS lsof occupancy
  in disposable synthetic fixtures, interrupted deletion, purpose isolation,
  concurrent success coalescing and native/query/index failure fences.
- Desktop typecheck passed. First aggregate source run passed; final aggregate
  revalidation follows the concurrency/metadata refinements.
- No real-profile deletion, new installer, application launch, model request,
  Windows certification, commit, push or release was performed in this task.
- Product contract and ADR updated; pre-existing WIP retained. Code lives in
  apps/desktop/src/openviking-runtime-retirement.ts and the existing service,
  installed runtime composition, team scheduling/query and shutdown seams.

## Source closeout

Final `corepack pnpm run check:source` passed (exit 0): 952 test files passed,
9 skipped; 6,343 tests passed, 24 skipped. Branch coverage 78.81%; all configured
coverage thresholds passed. Protocol/typecheck/lint/architecture/dead-code/reference/
structure/transport/workflow checks passed. Full log: /tmp/pi67-retirement-source-final.log.
`git diff --check` passed. No packaged/runtime upgrade or Windows claim is made;
the new logic becomes effective only in a later built/installed application.

Source HEAD remains uncommitted working-tree changes; no commit/push/release.
This plan and the product/ADR changes document the authorized replacement of the
previous indefinite old-runtime retention policy. Existing unrelated WIP preserved.

## Isolated packaged acceptance (2026-10-05)

The user authorized a local unsigned candidate and disposable-profile native
acceptance. Built alpha.43 from the current dirty worktree (not a publishable
exact-commit candidate). `package:native:unsigned` passed; DMG checksum verification
and ZIP integrity verification passed. Real user profile remains read-only as a
source of signed 0.4.22 runtime bytes; old signed development assemblies seed
0.4.16 private/index/query fixtures. Synthetic credentials and loopback model only.

The first preparation failed before application launch because Node's forced
clone copy returned ENOSYS. A focused copy probe confirmed this; the harness uses
macOS `/bin/cp -cR` instead. No product source change or blind native retry.

Runner: `eng/packaging/probe-packaged-runtime-retirement.mjs`. Receipt:
`artifacts/runtime-retirement-packaged/run-r6Nu4H/receipt.json`.
Current asar SHA-256:
`8626a0c354419f6a5a2b60d754fbb2ec71fd14ceb55afe3ab27086a5099357e7`.

Acceptance PASS: disabled memory preserves old runtime; a real process with cwd
in the old payload causes `deferred`; after it exits, actual 0.4.22 private
native startup triggers old-private payload retirement; old team purposes remain.
An authentic product journal plus partially removed old payload resumes deletion
on the next successful native start. This is simulated partial deletion, not
an OS crash test. Team index/query success retirement remains source-test evidence.

All launches physically exited; the successful test profile and the failed
pre-launch preparation profile were removed. Source manifest hashes stayed equal.
The local model fixture observed 60 embedding calls, zero extraction/agent calls,
zero rejected requests; no external paid provider was used. Runner syntax/lint
and final diff whitespace checks passed. No broad packaged smoke/Windows
certification, installed-app replacement, commit, push or release is claimed.

Retained local alpha.43 artifacts: unpacked app 884 MiB, ZIP 327 MiB, DMG 320 MiB
(du allocation readings). These are local validation outputs from dirty WIP.

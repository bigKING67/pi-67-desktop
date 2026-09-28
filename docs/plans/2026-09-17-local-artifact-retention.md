# Local artifact retention

Status: completed
Owner: Codex
Started: 2026-09-17

## Goal and acceptance

Bound generated native runtime and release payload retention. Repeated identical
inputs reuse verified outputs; retain two successful outputs and one failed
payload per generator and native purpose. Pins, active use, unknown legacy outputs and concurrent
operations fail closed. Release retention preserves two successful versions and one failed version per platform,
evidence and unpacked/running applications. Tests cover repeated runs, changed
inputs, failures, pins, active use, tampering and concurrent operations.

## Delivery boundary and non-goals

Local source changes and isolated regression/native filesystem validation only.
No commit, push, publication, production installation, application shutdown,
credential changes or further legacy artifact deletion. No dependency changes.

## Current evidence and WIP

Main HEAD ca043bac043697480ef6e2804ad6bf41a28fb79f, two ahead of local
origin/main, 444 dirty paths at entry. Existing dirty/untracked implementation
is intentional and preserved. Native preparation/signing use mkdtemp without
reuse/retention; manual release cleanup is separate and blocks on active preview.
Earlier exact duplicate cleanup left four legacy signed runtimes protected.

## Scope and decisions

- eng/capabilities: shared owned-artifact lifecycle for preparation and signing;
  metadata stays in ignored artifacts, never inside a measured runtime tree.
- eng/release and packaging: separate archive retention from full manual cleanup.
- Legacy artifacts without new ownership metadata remain protected. A `.keep`
  file pins a managed output. A parent lock prevents competing generators from
  selecting/deleting each other's outputs. Protected capacity stops new builds.
- Reuse validates content; corrupt evidence fails rather than silently accepting.

## Checkpoints

- [x] Native input identity, reuse, bounded success/failure retention and protection.
- [x] Release archive retention and packaging integration.
- [x] Regression tests, live read-only plan and isolated real filesystem smoke.
- [x] Scoped final diff, documentation and closeout.

## Rollback

Restore only this task's source hunks using the pre-edit snapshots; preserve all
earlier WIP. Generated payload eviction is not reversible from Git; retained
successful versions/pinned legacy inputs remain available, otherwise rebuild.
No runtime trust, installed application or production data changes are involved.

## Validation and risks

47 targeted Vitest tests passed across nine files (44 initial cases, then three
additional failed-release capacity/rollback cases; affected release cases rerun). Scoped
Oxlint type-aware/type-check passed. Structure gate passed (3257 governed files);
architecture gate passed (1080 modules, 4151 imports, zero cycles).

Real macOS arm64 offline preparation passed both native probes (13 checks each),
measured 54346 files / 641302721 content bytes. The test-installation runtime was
automatically removed. A second identical invocation reused the same directory;
both before and after were 756472 KiB, zero payload growth. The task-only prepared
runtime was reclaimed afterward, with receipts and verification JSON retained.
The four pre-existing signed runtimes and running preview application remain.

Windows native process probing, full packaged builds and installer validation
were not run in this task; no such claims follow from the fixtures. Process/pin exclusions can prevent reclamation;
surface this explicitly instead of exceeding capacity silently.

## Closeout

- Evidence: `artifacts/native-artifact-retention-verification.json` and
  `artifacts/native-artifact-retention-smoke.log` (ignored generated output).
- Read-only `release:local:retain` plan: zero eligible old archives; twelve current
  archive/container companion files retained across the two existing versions.
- Rollback remains scoped source-hunk restoration from the pre-edit snapshots;
  earlier dirty work was not reset, staged or committed.
- New modules stay in existing eng/capabilities, eng/release and eng/packaging
  boundaries. No dependency, product runtime, installed state or remote mutation.
- Limits are counts per managed generator/purpose or archive platform; legacy,
  explicitly pinned and historical small evidence are not a global byte quota.
- Commit/push/release: not performed. Source HEAD unchanged.

## Follow-up: SDK footprint and historical ownership

Authorized on 2026-09-17 after the remaining footprint audit. Preserve source WIP,
the four existing signed payloads and retained Alpha.41 archives while testing.
This follow-up extends the initial phase's cleanup boundary to retiring the old
private input after verifying its retained replacement; production boundaries remain.
No production key access, user installation replacement, commit, push or release.

- [x] Prune the locked Volcengine SDK only in fresh preparation staging, before
  hashing. Retain Ark runtime, Ark management and core; validate wheel RECORD,
  update installed metadata and bind the transformation to preparation identity.
- [x] Exercise provider requests and real native storage/search on slim outputs;
  retain small receipts and retire task-only validation payloads after completion.
- [x] Admit historical signed outputs into bounded ownership only after full
  source-trust signature/tree verification; never alter their signed contents.
- [x] Report exact measured saving, retained replacement and retirement limits.

Rollback: restore only this follow-up's source hunks using scoped snapshots at
`/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/pi67-footprint-source-_2hljd9v`.
Do not reinterpret changed bytes as an old signed identity. The retained signed
inputs remain the rollback source until a separately verified replacement exists.

### Follow-up validation and result

- SDK unit boundaries plus existing preparation/store/signing/input regressions:
  42 tests passed. Scoped type-aware Oxlint passed. Structure: 3260 governed files;
  architecture: 1080 modules, 4151 imports, zero cycles.
- Private, team-index and team-query fresh offline preparations all passed Ark
  sync/async chat/embedding/denial probes and both 13-check native storage/search/
  isolation/restart probes. Private LiteLLM missing-dependency and request probes
  passed. Test-only price metadata is forced local; zero external connections.
- Slim Main private-service regression: 1 passed. Real team index/query/Host
  success, denial, cancellation and mismatch regressions: 7 passed. These use
  synthetic models and ephemeral test trust, not production signing or release.
- Existing signed VnpfTu replacement passed 2 native service/session regressions,
  including capture, extraction and recall. All four historical signature/tree
  identities verified before explicit ownership adoption. Retired only the
  superseded o58lbB runtime (751676 KiB); retained its manifest, signature and
  assembly receipt. VnpfTu, qadQjd and Vzbzxd remain READY under bounded ownership.
- Compared with the existing private runtime: 751680 -> 508632 KiB, approximately
  32% smaller. The SDK transform removes 135 modules / 25748 files / 193739293
  content bytes. The current requirements lock remains authoritative for other
  dependency differences. Repeated identical preparation reused lV7Esj with no
  new payload. All six task-only preparation payloads were reclaimed afterward;
  macOS Spotlight temporarily held the last copy, so cleanup waited for release.
- Final repository measurement: 5163504 KiB (about 5.29 decimal GB). Native
  candidate receipts/logs and `artifacts/native-sdk-footprint-verification.json`
  preserve evidence; Alpha.41 DMG/ZIP and user data were not modified.
- The new transform applies to future preparations. Existing retained signed
  runtime bytes are unchanged; no new production signatures, packaged slim
  installer, Windows certification, commit, push or release. Per-purpose retention
  is still a count limit, not a whole-repository byte quota.

## Follow-up: repository storage budget

Historical first implementation; the advisory revision below supersedes its
byte-based blocking behavior. Its recorded test evidence remains historical.

User approved 8 decimal GB warning / 10 GB pre-build blocking on 2026-09-17.
Add a read-only repository-wide accounting command, shared large-build lock,
preflight reservations and a post-build check. Preserve outputs on overflow;
this is not an OS quota or authorization for further cleanup.

- [x] Measure hidden/ignored content, without following external symlinks or
  counting hardlinks twice; reject unsafe policy and incomplete scans.
- [x] Gate new native preparation/signing and signed/unsigned desktop packaging;
  cached verified native reuse remains possible. Keep resource preparation inside
  the packaging reservation. Serialize the covered producers.
- [x] Exercise refusal, warnings, underestimated growth, failures, concurrency,
  cache reuse and packaging integration on small temporary fixtures.
- [x] Run live read-only accounting, scoped quality checks and document limits.

Rollback: restore only this phase's source hunks from
`/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/pi67-storage-budget-qf1nezzk`;
remove its new policy/helper/test source files. No generated payload or user data
is deleted by the storage guard. Existing retention remains separately scoped.

### Storage budget validation and result

- 25 targeted tests passed; full `corepack pnpm run check:source` passed:
  852 test files / 5525 tests passed, 9 files / 23 tests skipped by their native or
  opt-in conditions. Full typecheck, type-aware lint, dependency/reference,
  transport and workflow source gates passed. Structure: 3263 files;
  architecture: 1080 modules / 4151 imports / zero cycles. Coverage passed.
- Real checkout read-only CLI and shared-lock no-build callback passed. Final
  conservative accounting: approximately 5.30 GB; desktop build reservation:
  2.50 GB; projected 7.80 GB, below the 8 GB warning / 10 GB block thresholds.
  `du -sk` reported 5163740 KiB; accounting differences are intentional.
- Alpha.41 DMG/ZIP sizes and SHA-256 match their macOS candidate identity. Three
  managed signed runtimes remain READY/present; preview app remains absent.
  No production key access, new native payload or package build in this phase.
- Evidence: `artifacts/local-storage-budget-verification.json`,
  `artifacts/local-storage-budget-snapshot.json`,
  `artifacts/local-storage-budget-lock-smoke.json` and
  `artifacts/local-storage-source-check.log` (ignored, small local output).
- Covered entry points use pre/post accounting and a shared lock; standalone
  resource/performance commands and arbitrary writers remain outside the gate.
  This is not a filesystem quota, physical APFS allocation guarantee or Windows
  native certification. Source changes are uncommitted; HEAD unchanged.

## Follow-up: keep storage warnings advisory for development

The user superseded the hard limit after reviewing maintenance impact: 8 GB
warning / 10 GB strong warning, with no refusal based on repository total.
The fixed 2.5 GB packaging estimate could otherwise refuse a build at 7.6 GB,
even if it only replaced existing files. Briefly exceeding 10 GB is not by
itself proof of a leak; track retained copies and post-build growth instead.

- [x] Use policy v2 with `strongWarningBytes` and `HIGH_WARNING`, allowing the
  callback and preserving success both before and after threshold crossings.
- [x] Keep real build errors, path/policy validation, count retention and locks;
  test over-threshold native generation, packaging and CLI exit status.
- [x] Verify ordinary build, affected regression suites and live read-only check.

Scope: local tooling and its tests/docs only. No deletion, new native payload,
installer build, application lifecycle, commit, push or external operation.
Rollback snapshots:
`/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/pi67-storage-advisory-ypbmcro7`.
Do not restore the obsolete hard limit without a new user decision.

### Advisory revision validation and result

- Actual ordinary `corepack pnpm run build` passed on the canonical checkout;
  development source build does not use the storage wrapper. No application was
  launched or stopped, and no installer/native runtime was rebuilt.
- 30 targeted tests passed across four files, including over-threshold native
  generation/packaging, crossing the threshold during a successful build, CLI
  exit zero, warning boundaries, original/falsy build failure preservation, pins,
  busy outputs, shared/stale locks and filesystem identity protections.
- Scoped type-aware/type-check Oxlint passed. Live `storage:check --for
  desktopPackaging` passed: approximately 5.30 GB current / 7.80 GB projected.
  The earlier full source gate remains historical evidence; the changed advisory
  contract was validated with the affected tests, not another packaged/Windows run.
- Current evidence: `artifacts/local-storage-advisory-verification.json`,
  `artifacts/local-storage-advisory-snapshot.json`,
  `artifacts/local-storage-advisory-tests.log`, and
  `artifacts/local-storage-development-build.log`. Prior hard-limit reports are
  historical and must not be treated as the current policy.
- Policy v2 supersedes hard refusal by byte total. Count retention, locks, active
  use and pin protection are unchanged. Total storage may exceed 10 GB; monitor
  growth and use the existing exact-path retention/cleanup flows when warranted.
- No commit, push, cleanup of retained artifacts, publication or user data change.

## Follow-up: avoid maintenance-only native rebuilds

Live reproduction confirmed that edits to capabilities README, Desktop unit tests
and `.DS_Store` changed the native preparation key despite unchanged runtime input.
The regression test failed before implementation. Scope is the preparation input
key and its maintenance contract, preserving advisory capacity and bounded payload
retention. Toolchain/current and capabilities/current replace their outputs; old
download/source caches are still separately reported, not newly deleted here.

- [x] Exclude only source-root READMEs, JS/TS `*.test.*`, `.DS_Store` and
  `__pycache__`; keep production probes, interpreter, patches, verifiers, locks,
  purpose/mode/Node identity and unknown files as inputs.
- [x] Confirm maintenance edits reuse and production edits invalidate the key;
  test both cached and changed-input lifecycle without creating large runtimes.
- [x] Run scoped checks and finish with live retained-output inventory.

Revision v2 intentionally invalidates a prior v1 preparation once. Existing
signed payloads and their independent tree/trust identity remain unchanged.
Rollback source snapshots:
`/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/pi67-native-cache-inputs-5s4t75r6`.
No real runtime preparation/signing, installer build, extra legacy cleanup,
application lifecycle, commit, push or release is authorized by this follow-up.

### Maintenance cache validation and result

- Original code reproduced cache invalidation on README, unit-test and Finder
  metadata changes; the new regression failed before the fix and passed after it.
- 35 distinct targeted cases passed across input/store/preparation/signing tests:
  initial suite 34 passed, then the expanded input group 3 passed. Scoped
  type-aware/type-check lint passed. Integration fixtures exercise README reuse,
  two dependency upgrades, two successful payloads retained and receipt preservation.
- Source interpreter/bootstrap/lock/verifier changes still invalidate reuse;
  purpose/mode changes and escaping symlinks remain covered. Production probes,
  patches and unknown files are explicitly tested as inputs. No broad dependency
  graph cache or automatic adoption was introduced.
- Live inventory: three READY signed installations, Alpha.41 DMG/ZIP unchanged in
  the retained set; archive retention dry-run had zero eligible bytes and four
  retained archive/blockmap files. Current conservative storage remains about
  5.30 GB. Advisory policy v2 remains 8 GB / 10 GB; no threshold blocking restored.
- Evidence: `artifacts/native-cache-maintenance-verification.json`, before/after
  test logs and read-only storage/release-plan output. No large runtime rebuild,
  production signing, packaged validation, Windows native check or commit/push.
- Existing download/source caches and small historical receipts remain counted
  but are not automatically reclaimed by this change. No further legacy payload
  or user data was deleted. HEAD and earlier WIP are preserved.

## Follow-up: real default-path native reuse acceptance

Run one offline private runtime preparation on macOS arm64 and repeat identical
inputs through the exported default producer. Verify Ark/native probes, the new
advisory accounting, cache reuse, no additional payload on the second invocation,
and unchanged protected signed trees/Alpha.41 archives. This extends the prior
source/fixture-only phase with real native preparation, not a packaged release.

- [x] Snapshot protected tree/archive identities and pre-existing output names.
- [x] Fresh private preparation and same-input reuse pass on the real host.
- [x] Retire only this task's generated preparation/probe payloads after process
  protection, preserving small receipts and all protected artifacts.
- [x] Re-measure storage and record exact evidence/remaining acceptance limits.

No source optimization, production key, installed profile, application lifecycle,
installer generation, commit, push or remote action in this acceptance pass.
Only this pass's disposable outputs may be cleaned up; failed evidence is retained
until diagnosed. Do not evict the three protected signed runtimes or Alpha.41.

### Real native acceptance result

- Offline macOS arm64 private preparation through the default exported producer
  passed Ark sync/async chat/embedding/denial checks and two 13-check native
  storage, authorization, isolation, restart and revocation probes, including the
  assembled test installation. Test assembly used disposable trust only.
- First invocation created preparation-6cH9q9; second invocation returned
  VERIFIED_EXISTING at the same path. Directory count increased by zero on reuse;
  the owned directory was 505616 KiB before and after reuse (zero growth).
- All three retained signed runtime trees and Alpha.41 DMG/ZIP hashes matched
  before/after the native run. No production key, installed profile or app action.
- Only the new preparation payload and the two exact synthetic probe roots were
  reclaimed after no-pin/process/open-file and identity checks. Preparation was
  marked RETIRED; preparation, assembly and both probe receipts remain. No locks
  remain. Final checkout accounting is about 5.30 GB.
- Evidence: `artifacts/native-cache-live-verification.json`,
  `artifacts/native-cache-live-check.log`, two preserved probe JSON receipts and
  `artifacts/native-cache-live-final-storage.json`. This is real native preparation
  and reuse evidence, not an installer build, Windows or paid-provider test.
- This local storage/maintenance acceptance is complete. Advisory 8 GB / 10 GB
  behavior remains; no additional source changes, commit, push or release.

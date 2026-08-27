# Update progress observability and Alpha.36 internal publication

Status: active
Owner: Codex
Started: 2026-08-27
Last updated: 2026-08-27

## Goal

Make the two currently opaque long-running paths visibly truthful: the Windows
in-app NSIS replacement after Pi-67 exits, and the operator-side R2 upload and
public readback before the manifest is published. Bound normal R2 storage by
retaining at most the newest three recognized Pi-67 versions after a safe cutover.
Build and distribute these byte-changing improvements as `0.1.0-alpha.36`, then
publish the same accepted Candidate through the internal R2 update channel.

## Non-goals

- Do not weaken full-byte, SHA-256, immutable-cache, Range, or publish-last
  release verification.
- Do not claim or optimize a specific Windows install duration without new
  target-host measurements.
- Do not change artifact identity, version, signing, distribution, or update
  authorization policy in this change set.
- Do not perform a credentialed publication, remote cleanup, promotion, or
  Candidate distribution before exact-source packaging and required target-host
  acceptance.
- Do not create a Git tag, GitHub Release, signed build, notarized build, or
  stable-channel promotion.

## Acceptance criteria

- A Windows `--updated` install retains silent/no-choice semantics and automatic
  relaunch, while showing a Pi-67-owned installation-in-progress surface for the
  entire replacement phase after the old app exits.
- The in-app copy states that Windows will close and continue in a separate
  installer window rather than implying that the Electron window itself remains.
- R2 publication reports named stages to stderr, including artifact identity,
  actual transferred bytes, rate, ETA when calculable, elapsed time, and bounded
  liveness heartbeats; stdout remains one machine-readable JSON result.
- The operator output explicitly distinguishes immutable upload/direct readback,
  public full-byte verification, and the final manifest switch.
- Release receipts contain stage/transfer timing summaries without credentials,
  request headers, or raw response bodies.
- Read-only planning previews the three-version retention result. Publication
  deletes only exact recognized fourth-or-older version artifacts after public
  manifest verification, preserves unknown objects, and verifies the final list.
- A recognized future version in preflight stops publication before any write;
  failures before manifest cutover never delete existing rollback versions.
- Focused tests, typecheck, lint, structure, and diff checks pass. Real Windows
  Candidate evidence remains mandatory before the Windows behavior is accepted.
- All eight workspace manifests identify `0.1.0-alpha.36`; Windows x64 and macOS
  arm64 artifacts come from one exact `origin/main` SHA and are mirrored in
  Feishu before the Windows manual-test checkpoint.
- Only after the exact Alpha.36 Windows Candidate is accepted may the same
  verified bytes and no-store manifest be published to R2.

## Delivery boundary

- Local implementation and Alpha.36 versioning: authorized.
- Scoped commit and push to `main`: authorized as prerequisites of the user's
  current explicit publication/upload request.
- Windows GitHub Actions Candidate, local macOS Candidate, and Feishu upload:
  authorized.
- Internal unsigned R2 publication and bounded post-cutover three-version
  retention deletion: authorized after exact Alpha.36 Windows acceptance.
- Git tag, GitHub Release, signing, notarization, stable promotion, arbitrary
  remote deletion, and cache purge: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | The canonical checkout is clean at `ed6ded0807b7678566d500b5096f197801229c98` and matches `origin/main`. | live Git | 2026-08-27 |
| OBSERVED | Alpha.34 to Alpha.35 completed on real Windows x64, relaunched, and restored the Desktop shortcut, but the post-exit NSIS phase was not visible. | operator report | 2026-08-27 |
| OBSERVED | Hosted Windows lifecycle evidence measured about 119 seconds for upgrade and about 6 seconds to relaunch readiness; it does not prove the operator host duration. | Alpha.35 lifecycle summary | 2026-08-27 |
| OBSERVED | R2 publish performs three full public artifact readbacks sequentially before writing the manifest and currently emits only final JSON. | current release implementation | 2026-08-27 |
| OBSERVED | The Alpha.35 publish process remained alive for more than 52 minutes after upload while full public verification transferred about 802 MB without phase output. | live process/network observation | 2026-08-27 |
| OBSERVED | The canonical checkout started this release at `ed6ded0 == origin/main`, with the complete observability/retention change uncommitted and all manifests still on Alpha.35. | live Git and version scan | 2026-08-27 |
| OBSERVED | Candidate freshness initially found browser67 and AI Berkshire stale. browser67 then published formal `v0.5.0`; its annotated Tag resolves to the same `aa8ca485` commit as `main`, and the final increment adds the versioned MCP identities plus upstream/CI contract hardening. AI Berkshire advanced through `e83c2544`; every increment changed reports only, while the exact-source provenance adapter retained the same 21 members and produced reproducible Pack `1.0.6`. | GitHub Release/Tag/compare, isolated adapter, generated hashes | 2026-08-27 |
| OBSERVED | Windows Candidate run `33064062825` bound to source `4c734201` stopped before build because browser67 `main` advanced by one same-version commit from `aa8ca485` to `ff0396f3`. The increment scopes cleanup by Browser Instance and fails closed on ambiguous multi-instance lifecycle operations; browser67 remains version `0.5.0`. | GitHub Actions provenance log, GitHub compare, browser67 package metadata | 2026-08-27 |
| OBSERVED | Windows Candidate run `33076732169` bound source `5e109390` and again timed out only during the Alpha.35 to Alpha.36 update process. The exact Candidate was installed but its installer process did not exit within 240 seconds. `SpiderBanner`'s function contract requires `Show /NOUNLOAD` when the same plugin instance later receives `Destroy`; the first cleanup fix added `Destroy` but did not retain that instance. | lifecycle summary, exact installer source, SpiderBanner plugin documentation/example | 2026-08-27 |

## Affected boundaries

- Modules/processes: Electron update handoff, electron-builder NSIS include,
  Cloudflare R2 S3 client, public verification, release CLI, receipts.
- Protocol or persisted state: no cross-process protocol or product state shape
  changes; release receipt gains observability and bounded retention summaries.
- Platform/artifact: Windows x64 NSIS behavior changes and therefore requires a
  new immutable Candidate identity before distribution.
- Security/privacy: progress output contains only public artifact names, byte
  counts, timings, and stages; it must never print operator credentials.
- Existing WIP: none at plan start.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Preserve `/S`, `--updated`, and `--force-run`, but promote only the target install-progress page to visible. | Alpha.35 already owns the source-side invocation, while the accepted upgrade path still requires no choices and automatic relaunch. The target installer can skip mode/directory pages, show native install progress, auto-close, and restart without changing old arguments. | Windows Candidate proves the native progress page cannot render or the choice pages cannot remain suppressed. |
| Show indeterminate installation liveness, not a fabricated percentage. | NSIS extraction does not expose a reliable product-level completion percentage through the current integration. | A measured helper protocol exposes trustworthy stage/byte progress. |
| Emit release progress on stderr and final JSON on stdout. | Humans need live feedback while scripts must retain stable parseable output. | The CLI adopts a versioned structured event stream as its primary contract. |
| Keep full public SHA readback and manifest-last publication. | The hour-long path is an integrity and atomicity boundary, not disposable overhead. | A different verified origin-side checksum contract replaces client readback with equivalent evidence. |
| Instrument first; tune transfer concurrency/compression separately. | Current evidence identifies opacity but does not isolate the dominant performance bottleneck across hosts and networks. | New metrics identify a safe, independently testable speed bottleneck. |
| Retain the target and two newest lower SemVer versions after exact manifest verification. | This bounds normal R2 storage while preserving two rollback artifact sets and never deletes before a successful cutover. | The storage budget or rollback policy changes explicitly. |
| Delete only parser-recognized objects and fail closed on future versions. | Unknown objects may be operator-owned, while a future version indicates stale or concurrent release state that must not be guessed through. | R2 gains a stronger namespaced inventory authority with equivalent ownership evidence. |
| Do not purge old immutable edge entries during automatic retention. | R2 deletion satisfies bucket storage control without requiring broader Cloudflare API authority; unreferenced edge copies expire independently. | Product policy requires immediate withdrawal rather than storage cleanup. |
| Advance the reviewed branch-tracked capability locks before freezing Alpha.36. | Candidate provenance is fail-closed and must not silently package stale browser runtime or Skill Pack inputs. | Sources move again before exact-source dispatch or the freshness policy changes explicitly. |

## Checkpoints

- [x] 1. Add deterministic release progress/metrics primitives with unit tests.
- [x] 2. Wire upload, direct R2 readback, public verification, and manifest stages
  without weakening release order or stdout JSON.
- [x] 3. Add a silent-update-only NSIS progress surface and precise in-app handoff
  copy while preserving automatic relaunch and shortcut repair.
- [x] 4. Pass focused and repository source gates; record target-platform gaps.
- [x] 5. Add read-only retention planning and post-manifest automatic cleanup for
  the fourth and older recognized versions, with fail-closed inventory checks.
- [x] 6. Freeze Alpha.36 in all manifests, scoped commit, push, and prove exact
  `main == origin/main` source identity.
- [ ] 7. Build exact-SHA Windows/macOS Candidates, verify their identities, and
  upload the three versioned product files to Feishu.
- [ ] 8. Record the user's real Windows x64 acceptance for the exact Candidate,
  then measure visibility, install duration, relaunch, and shortcut continuity.
- [ ] 9. Prepare and publish the exact accepted artifacts to R2, verify public
  hashes/Range/manifest, and confirm automatic three-version retention.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | focused Vitest for release, updater, packaging, and Capability modules; targeted Renderer E2E | deterministic progress events, ordering, Capability projection, no contract regression | passed: 63 focused tests across six files and eight Renderer E2E tests |
| Tests | full Vitest coverage, `typecheck`, `lint`, build, architecture, references, production transport, structure, `git diff --check` | no source gate failure | passed on final current tree: 601 files; 3,132 passed, 3 platform skips; all source gates and build passed |
| Runtime/host | deterministic reporter exercise; exact Alpha.36 macOS unsigned preview | bounded stderr liveness, platform-specific copy, packaged launch | reporter and exact `5e109390` macOS package/smoke/open passed |
| Packaged artifact | exact-SHA Windows Candidate; macOS package/smoke/open | updater surface compiles; packaged application remains healthy | exact macOS Candidate passed; Windows build/package/UI passed but Candidate certification remains blocked by update installer exit |
| Target OS/manual | real Windows x64 in-app update | visible post-exit progress, measured duration, relaunch, shortcut | authorized and pending exact Candidate distribution |

## Rollback

- Revert the progress reporter wiring without changing the release contract if
  stderr output breaks a caller; stdout JSON remains the compatibility boundary.
- Remove the NSIS progress calls and retain the existing `/S --updated
  --force-run` arguments if Candidate compilation or real Windows rendering
  fails; do not remove shortcut repair or change install location behavior.
- Never reuse or overwrite an already published immutable version after a
  packaged-byte change.

## Risks and unknowns

- The NSIS progress plugin must be available in electron-builder's Windows
  toolchain and must render while the installer remains silent.
- Hosted Windows timings are not the user's hardware/network timings.
- Byte progress may pause during server response latency or local hashing, so a
  heartbeat must distinguish alive-but-no-new-bytes from a completed stage.
- Public verification is intentionally sequential in this patch; concurrency
  changes would need separate rate-limit, memory, and failure-isolation evidence.
- A deletion failure occurs after the new manifest is current by design; the
  command fails visibly and can be retried idempotently to complete retention.
- Unknown R2 objects are preserved and can still consume storage; the automatic
  policy controls only exact Pi-67 versioned artifacts.
- R2 listing plus per-object deletion is not transactional. Publication remains
  a serialized operator action; a concurrent future object is preserved and is
  detected by the final inventory check when old artifacts were deleted.

## Progress log

- 2026-08-27: User authorized the recommended implementation. Live Git was
  clean at `ed6ded0`; frontend routing classified the visible copy as L1-F with
  `design-craft`, while Windows packaged behavior remains target-host evidence.
- 2026-08-27: Added rate-limited stderr progress for multipart upload, direct R2
  readback, and public full-byte verification. Stage output retains manifest
  state, heartbeats remain bounded during byte stalls, stdout stays one JSON
  result, and credential-free stage/transfer metrics enter the publish receipt.
- 2026-08-27: Added an update-only silent NSIS `SpiderBanner` without changing
  `/S`, `--updated`, or `--force-run`. The Renderer copy distinguishes Windows
  from macOS. The Windows lifecycle gate now requires a visible installer
  main-window observation and records it alongside relaunch and shortcut proof.
- 2026-08-27: The actual electron-builder 26.15.3 NSIS resources contained the
  Unicode and ANSI SpiderBanner plugin, and an isolated store-compression Windows
  compile smoke succeeded. Its 1.5 GB generated directory was removed. This is
  compile evidence, not real Windows visibility evidence or a Candidate.
- 2026-08-27: The final full single-worker test run passed 601 files with 3,128
  tests passed and three platform skips. Typecheck, lint, build, architecture,
  external references, production transport, structure, and diff checks passed.
  The unsigned macOS packaged smoke passed and opened exact current assets.
- 2026-08-27: Extended publication with a three-version R2 retention contract.
  The read-only plan previews exact deletions; runtime deletion begins only after
  public manifest equality, preserves unknown names, re-lists after deletion,
  and refuses recognized future versions before initial mutation.
- 2026-08-27: The final current-tree full rerun passed all 601 files with 3,132
  tests passed and three platform skips. One immediately preceding run had two
  unrelated temporary-directory cleanup/timeout failures; both original files
  passed alone before the clean full rerun, so no unrelated source was changed.
- 2026-08-27: User explicitly requested real publication and upload. Because the
  installer/UI bytes differ from published Alpha.35, the release identity was
  advanced to Alpha.36; commit, push, Candidate/Feishu distribution, and the
  post-acceptance internal R2 publication are now inside the authorized boundary.
- 2026-08-27: Freshness review advanced browser67 through the formal `v0.5.0`
  Release at `aa8ca485` (the annotated Tag and `main` resolve to the same exact
  commit). The included final increment versions both MCP identities as `0.5.0`
  and closes upstream-audit and Hub/background-job contract races. AI Berkshire
  advanced through `e83c2544`; those increments changed only reports. Because
  the adapter binds every member to the exact source commit, it regenerated the
  unchanged 21-member suite as `1.0.6` with manifest `2a711077...` and bundle
  `691ec7f0...` rather than reusing stale provenance hashes.
- 2026-08-27: Regenerated Capability output bound browser67 `0.5.0` and exact
  `gitHead=aa8ca485`; remote source fetchability and live freshness both passed.
  The final full coverage run passed 601 files with 3,132 tests and three skips.
  Two preceding full-concurrency runs consistently starved one Git-fixture test
  past Vitest's default five-second budget while that file passed alone in 2.96
  seconds; its integration-test timeout was raised to 15 seconds without changing
  assertions, after which the full run passed. Targeted resource UI E2E passed
  all eight tests.
- 2026-08-27: Pushed initial Alpha.36 source commit `4c734201`, then dispatched
  Windows Candidate run `33064062825`. Its provenance job passed source identity,
  unpublished-version, and source-fetchability checks but stopped before build
  when browser67 advanced to `ff0396f3`. The one-commit increment is still
  browser67 `0.5.0` and changes packaged lifecycle behavior, so the immutable
  lock and catalog advance to `2026.08.27.3` rather than bypassing freshness.
- 2026-08-27: The refreshed lock passed remote fetchability for all five source
  commits, live freshness for all first-party sources and the AI Berkshire Pack,
  Capability preparation and 10 focused tests, the eight-test Renderer resource
  suite, repository lint, and Git whitespace validation.
- 2026-08-27: Windows Candidate run `33070984818` bound source `945b2e4a` and
  passed provenance, packaging, packaged Electron smoke, UI/IME, identity, and
  artifact construction. Certification stopped only in the full Alpha.35 to
  Alpha.36 NSIS lifecycle: the updated silent installer remained alive for the
  240-second operation limit even though the application bytes were installed.
- 2026-08-27: Downloaded lifecycle diagnostics bound the failed installer to
  size `273807193` and SHA-256 `102e2e57...e3f6b`; the Alpha.35 baseline install,
  launch, and shutdown had already passed. Source/template inspection found the
  decisive mismatch: Desktop's update-only `SpiderBanner::Show` had no paired
  `SpiderBanner::Destroy`, while electron-builder owns banner cleanup only for
  its non-silent path. The fix now destroys the Desktop-owned banner on success
  and before both aborts; the lifecycle contract requires that pairing.
- 2026-08-27: The first macOS Alpha.36 artifact completed packaging but the
  packaged smoke appeared to hang after attachment staging. API logs plus an
  out-of-band DOM receipt proved the attachment was rendered and its manifest
  was complete while Playwright's Electron utility world stopped answering
  after file injection. The packaged test now dispatches a real in-memory
  `DragEvent` and observes the main Renderer world, preserving the real
  Renderer, Preload, Main, HEIC worker, staging, decode-failure, and retry path.
  The same artifact then passed the full packaged smoke; HEIC normalization
  produced a 27,948-byte 1024x1024 JPEG from 15,703 source bytes in 630 ms.
- 2026-08-27: Exact source `5e109390` packaged, smoked, and opened the Alpha.36
  macOS arm64 DMG/ZIP. Windows Candidate run `33076732169` passed provenance,
  build, packaged smoke, UI/IME, and byte identity, but the cross-version update
  installer again remained alive for the 240-second limit. Its exact installer
  is 273,807,320 bytes with SHA-256 `4f36920e...ab5686`.
- 2026-08-27: The second failure disproved the assumption that adding a late
  `Destroy` call alone was sufficient. SpiderBanner's documented contract and
  example retain `Show` with `/NOUNLOAD` before a later `Destroy`; without it,
  the cleanup call cannot address the original plugin instance. The update-only
  surface now uses `Show /NOUNLOAD /MODERN`, and the lifecycle test rejects the
  unloadable form.
- 2026-08-27: Exact-source Windows Candidate run `33079428481` compiled the
  retained SpiderBanner form and again passed provenance, package construction,
  packaged Electron smoke, UI/IME, and artifact identity, but the Alpha.35 to
  Alpha.36 installer still remained alive at the 240-second lifecycle boundary.
  This disproves missing `Destroy` and missing `/NOUNLOAD` as complete root
  causes. Before another product change, the verifier now preserves the already
  observed installer window result and captures a timeout-imminent, target-only
  process tree plus installed executable, uninstaller, and Desktop shortcut
  state. The existing Candidate bytes will be reused by the lifecycle-only debug
  workflow so the next decision is based on Windows runtime evidence rather than
  another packaging guess.
- 2026-08-27: Lifecycle-only debug run `33082032588` captured the installer at
  210 seconds: the only matching process was the original installer with no
  visible main window or child application; the new executable and uninstaller
  existed, but the executable remained unreadable for SHA-256 and the Desktop
  shortcut did not yet exist. The same runner needed 155.7 seconds for the
  Alpha.35 baseline install. This is evidence of an installation still writing
  before `customInstall`, not evidence of an automatically launched app holding
  the installer open. The per-process observation window is now 420 seconds and
  the verifier-only workflow budget is 25 minutes so the same Candidate can
  prove whether the operation eventually completes instead of being killed at a
  boundary already shorter than the real Windows observation.
- 2026-08-27: A second exact-artifact debug run, `33083311307`, extended the
  per-process boundary to 420 seconds and reproduced the same state at 390
  seconds. The installer never exposed a window, never created the repaired
  shortcut, never launched the application, and never released the installed
  executable. This rules out a merely slow but completing update. The remaining
  product-specific regression is the update-only SpiderBanner call from
  `.onInit`; electron-builder's maintained template and NSIS examples execute
  banner plugins from an install `Section`. The update banner now runs in a
  hidden leading Section declared through `customHeader`, before the maintained
  electron-builder install Section, while cleanup remains paired in
  `customInstall`.
- 2026-08-27: Candidate run `33085596260` stopped at provenance before any
  Windows build because browser67 `main` advanced from locked commit
  `ff0396f3` to `3c1d224b`. Exact source preparation then proved that commit is
  browser67 `0.6.0`, not the previous `0.5.0`; its tip refreshes the GenericAgent
  review artifacts. The Desktop lock and catalog now advance together to
  browser67 `0.6.0` and catalog `2026.08.27.4`; the freshness and package-version
  gates are preserved rather than bypassed.
- 2026-08-27: Candidate run `33086994507` bound source `d489ea14`, passed
  provenance, Windows package construction, packaged Electron smoke, UI/IME,
  and artifact identity, but the Alpha.35 to Alpha.36 installer reproduced the
  same hang for the extended 420-second limit. The timeout snapshot again found
  only the installer process, no visible window, an installed executable and
  uninstaller, and no repaired Desktop shortcut. Moving the banner into a
  Section therefore was not sufficient. The remaining mismatch with
  electron-builder's maintained invocation is Desktop's cross-Section retained
  plugin instance: the banner now uses plain `SpiderBanner::Show /MODERN`, with
  no `/NOUNLOAD` or manual `Destroy`, while preserving the hidden update-only
  Section and shortcut repair.
- 2026-08-28: Candidate run `33089439670/2` bound source `447abb2f`; its first
  build attempt stopped on a transient packaged 1.5x-scale shutdown budget, and
  the unchanged rerun passed build, packaged smoke, UI/IME, and identity. The
  exact Alpha.35 to Alpha.36 update then reproduced the same 420-second hang.
  Lifecycle-only run `33093232986` reused those exact installer bytes with the
  verifier aligned from `windowsHide: true` to the product's `false`; it again
  observed no window and the same pre-`customInstall` state. This rules out the
  verifier's launch visibility as the complete cause and, together with all
  earlier plugin variants, isolates any update-only `SpiderBanner` invocation as
  the regression. The fallback now removes that plugin entirely. On an existing
  Alpha.35 invocation, the target installer promotes only the maintained native
  InstFiles progress page from silent to visible, forces the already detected
  install mode, skips the existing update choice pages, auto-closes, repairs the
  shortcut, and explicitly restarts the updated app.
- 2026-08-28: Candidate run `33094717784` bound source `5f5bbbfc` and passed
  provenance, Windows packaging, packaged smoke, UI/IME, and identity. The
  lifecycle observed the native Setup window after 9.2 seconds; roughly 152
  seconds after the update process started, the Alpha.36 application was running
  and the repaired Desktop shortcut existed. The installer nevertheless remained
  on its assisted Finish page until the 420-second process timeout. This proves
  replacement, restart, shortcut repair, and visible progress all completed, and
  narrows the remaining failure to termination only: `SetAutoClose true` does
  not skip an assisted Finish page. The update-only `customInstall` now invokes
  electron-builder's existing `quitSuccess` immediately after starting the new
  app, after all application files, registry entries, Start Menu/Desktop links,
  and Pi-67 shortcut repair have completed.

## Closeout

- Final source SHA: to be bound by the successful Candidate after the Windows
  update hang is resolved; Candidate source
  `b5b24f86d4a5e87e9a8e8b9413b41721d104bfe4` still fails only at installer
  process termination.
- Changed files: update handoff copy/design/product contracts, NSIS include and
  lifecycle gate, R2 progress/client/publisher/retention tests, release operations
  guide, and this execution plan.
- Validation completed: current focused tests, final current-tree full coverage,
  source gates, build, Capability source fetch/freshness, resource UI E2E,
  isolated SpiderBanner compilation, exact-artifact lifecycle replay, and an
  exact-source full packaged macOS smoke/open. The native-progress NSIS source
  still requires an exact-SHA Windows build and target lifecycle after commit.
- Validation not completed: successful
  exact-SHA Windows Candidate/runtime observation, Feishu distribution, and
  credentialed R2 publication with live progress.
- Remaining risks: native InstFiles visibility, automatic close/relaunch, and the
  new PowerShell observation must pass on hosted and real Windows; live network
  rate/ETA and retention behavior must be observed on the next separately
  authorized R2 publication.
- Commit/push/release state: Alpha.36 source freeze, Candidate builds, Feishu
  upload, Windows acceptance, and R2 publication are active checkpoints; no Tag,
  GitHub Release, signing, notarization, or stable promotion is authorized.

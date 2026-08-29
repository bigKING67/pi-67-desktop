# Renderer E2E Fixture Recovery

Status: active
Owner: Codex primary session
Started: 2026-08-29
Last updated: 2026-08-29

## Goal

Restore the ordinary Renderer E2E lane by correcting proven browser-fixture
execution races, then bind a new exact source SHA to Windows and macOS candidate
evidence and replace the three existing Feishu candidate files. Keep the
packaged Electron shutdown gate bounded and observable when its Playwright
close request does not settle.

## Non-goals

- Do not change Renderer conversation, support-upload, Pi runtime, Session, or
  operation behavior to accommodate a broken mock.
- Do not change the support diagnostics schema, upload endpoint, Worker, Durable
  Object, R2 bucket, lifecycle, rate limit, account configuration, or usage.
- Do not weaken E2E assertions, increase Playwright assertion timeouts, retry a
  failing product action, or hide browser page errors.
- Do not create a Tag, GitHub Release, R2 update publication, or promotion.

## Acceptance criteria

- The mock command handler passed to `page.evaluate` has no imported runtime
  dependency for conversation page metadata.
- The support-upload pending test waits for the mock upload bridge to receive
  the request before resolving its pending Promise.
- The Inspector geometry test waits for the lazy WorkspaceShell Composer before
  measuring overlap ownership.
- The five previously failing conversation E2E cases and the support-upload E2E
  pass together without retries, followed by the complete Renderer E2E lane and
  aggregate source gate.
- A scoped commit is pushed only after local validation passes.
- A hung Playwright Electron close cannot consume the whole CI Job timeout,
  cannot be counted as a passing product shutdown, and emits the exact smoke
  stage plus bounded-close diagnostics before the test exits.
- A new exact-SHA Windows Candidate passes its formal lifecycle gate, and exact
  macOS arm64 DMG/ZIP artifacts pass packaged verification before the three
  existing Feishu files are overwritten.

## Delivery boundary

- Local implementation: authorized by the user's `按你的建议继续`.
- Commit: authorized after validation.
- Push: authorized for the new exact-SHA CI and Candidate.
- Candidate build/upload: the first exact-SHA Windows Candidate and exact
  three-file Feishu replacement were authorized and completed for `973a0fe`.
  Any second Candidate or replacement set after shutdown-harness hardening
  requires a fresh delivery decision.
- Tag/release/promotion: not authorized.
- Cloudflare/R2: no calls or mutations are authorized or required.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Ordinary CI run `33246192969` failed only after the Renderer E2E job failed; Quality, Windows native smoke, and macOS native smoke passed. | GitHub Actions jobs | 2026-08-29 |
| OBSERVED | Five conversation tests issue `message.page`, then time out because the browser raises `ReferenceError: pageMetadata is not defined`. | CI trace and exact-SHA local reproduction | 2026-08-29 |
| OBSERVED | Commit `541e718` moved `pageMetadata` from inside the `page.evaluate` installer closure to a Node module import. | Git history and live source | 2026-08-29 |
| OBSERVED | The support-upload CI trace calls `finishPending()` while the UI is collecting diagnostics; the bridge resolver is created only after `diagnostics.collect` and the later upload call. | CI trace and live test/controller source | 2026-08-29 |
| OBSERVED | The first complete local Renderer rerun passed 203/204 and failed Inspector overlap while its trace still showed the lazy conversation loading surface and no Composer; the isolated test repeated the same missing precondition. | local Playwright trace and isolated rerun | 2026-08-29 |
| OBSERVED | The worktree starts clean at `9c9b75a`, exactly equal to upstream and remote `main`. | live Git | 2026-08-29 |
| OBSERVED | CI run `33248103306` attempt 1 passed HEIC, then emitted nothing until the macOS Job's 35-minute timeout; Runner cleanup terminated the packaged Main and multiple Helper/Node processes. | GitHub Actions log | 2026-08-29 |
| OBSERVED | Attempt 2 on the same `973a0fe` SHA again passed HEIC, then remained in the same smoke step for 104 seconds until manually cancelled to stop wasting CI resources; Runner cleanup again found packaged Main and Helper processes. | GitHub Actions log | 2026-08-29 |
| OBSERVED | `measureElectronApplicationShutdown` awaited `application.close()` before applying its product-process budget, and the top-level cleanup repeated the same unbounded close. | live source and regression test | 2026-08-29 |
| OBSERVED | The local host held 39 PPID-1 controlled-fixture processes with the exact repository artifact command `Pi-67 Desktop Helper -e setInterval(...)`; they were enumerated, terminated as test residue, and absence was verified without touching the active preview Main. | local process table | 2026-08-29 |

## Affected boundaries

- Modules/processes: Playwright Renderer mock command installer, support-upload
  E2E synchronization, CI, Candidate provenance, and Feishu candidate mirror.
- Protocol or persisted state: none.
- Platform/artifact: test-only source change; new artifacts remain required for
  exact source-to-candidate identity.
- Security/privacy: no diagnostic bytes, payloads, credentials, paths, or remote
  support service calls are added.
- Existing WIP: none; the canonical checkout was clean before editing.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Install a self-contained conversation command handler through `page.evaluate`. | The first direct in-place restoration exceeded the governed file-size limit; extracting the complete cohesive handler keeps all runtime helpers in one browser closure and follows the existing mock-handler seam. | A supported bundling seam proves imported runtime dependencies are installed into the page. |
| Wait for one observed upload attempt before resolving pending upload. | The bridge invocation, not the earlier UI state, is the exact point at which the resolver exists. | The product contract changes so collection and upload become one synchronous bridge call. |
| Wait for the Composer before sampling Inspector overlap. | A missing lazy surface is not evidence about stacking ownership; the original geometry assertions remain unchanged. | The Inspector contract no longer depends on the Composer plane. |
| Keep every existing behavior assertion and timeout. | The failures are fixture execution defects, not slow product behavior. | New evidence shows a real product deadline is invalid. |
| Add a 15-second Playwright close deadline separate from the existing 5-second product budget. | Driver teardown latency and product process exit are different evidence; neither may wait for the 35-minute Job deadline. | Playwright supplies a native bounded Electron close with equivalent diagnostics. |
| Fail closed after the close deadline and terminate only the exact launched Main PID for cleanup. | Forced termination is cleanup evidence, never a successful product shutdown; exact PID targeting avoids unrelated apps. | The launched process is already absent, in which case no termination is requested. |
| Set the owned application reference to `undefined` before a bounded close starts. | A failed close must not be retried indefinitely by the outer `finally`. | Cleanup becomes natively idempotent and bounded. |

## Checkpoints

- [x] 1. Recheck clean Git and correlate both failures to exact source lines and CI traces.
- [x] 2. Apply the minimal test-fixture fixes and pass the focused cases.
- [x] 3. Pass full Renderer E2E, affected typecheck, and aggregate source gates.
- [x] 4. Audit and create the scoped commit, push, and verify exact remote parity.
- [x] 5. Pass a new exact-SHA Windows Candidate and exact macOS packaged preview.
- [x] 6. Replace and verify the exact three Feishu candidate files.
- [x] 7. Reproduce the independent macOS CI hang twice and stop the second run
  once repetition was proven.
- [ ] 8. Commit and push bounded shutdown-harness diagnostics, then obtain a
  terminal ordinary CI result without weakening product shutdown evidence.
- [ ] 9. Decide whether a second exact-SHA Candidate and Feishu replacement are
  required for the test-harness-only follow-up commit.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | scoped diff, `git diff --check`, affected typecheck, aggregate check | only plan and test-fixture paths; all source gates pass | `PASS`: diff check, tests TypeScript, lint, architecture, structure governance, and all remaining aggregate checks passed; the first coverage run had one unrelated Provider startup-budget failure, its exact isolated rerun passed, and the second complete coverage run passed 614/614 files with 3200 tests passing and 3 skipped |
| Tests | focused cases, then complete Renderer Chromium E2E with CI worker settings | no retries, page errors, or stale pending uploads | `PASS`: focused final-structure run passed 23/23; complete final-structure lane passed 204/204 with two workers and zero retries |
| Runtime/host | exact macOS unsigned preview | packaged smoke and real Agent Host roundtrip pass | `PASS` at `973a0fe`; dirty-source harness rerun also passed with HEIC and every new stage marker, product exit 83.4ms, driver close 83.3ms, and zero controlled-child residue |
| Packaged artifact | formal exact-SHA Windows Candidate | cross-version dual-profile lifecycle passes | `PASS`: run `33248131097`, attempt 1, artifact `windows-candidate-33248131097-1`, exact source `973a0fe` |
| Target OS/manual | operator testing on the target Windows laptop | remains separate from hosted Candidate evidence | pending |

## Rollback

Revert only this plan, the restored in-closure helper, the removed single-caller
helper module, and the upload test synchronization line. No product state,
protocol, Worker, R2, Feishu permission, or migration rollback is required.

## Risks and unknowns

- GitHub-hosted Windows lifecycle evidence does not prove the user's Defender,
  EDR, OneDrive, redirected profile, or hardware behavior.
- Feishu folder-level direct-child verification remains unavailable without the
  configured destination folder token; exact existing file-token overwrite and
  unique-title verification are the available authority.
- The bounded-close hardening is test-harness source after the distributed
  `973a0fe` Candidate. It changes no product runtime code, but exact source SHA
  identity still requires an explicit decision before another Candidate build.

## Progress log

- 2026-08-29: User authorized continuation. Rechecked clean exact remote parity,
  retained a zero-Cloudflare/R2 boundary, and began the minimal fixture repair.
- 2026-08-29: Focused conversation/upload E2E passed 22/22. The first complete
  Renderer rerun passed 203/204 and exposed an independent Inspector test that
  sampled overlap before the lazy Composer existed; the isolated test reproduced
  the same precondition failure, so the test now waits for that required surface.
- 2026-08-29: The repaired Inspector test passed 2/2 with its bootstrap, then the
  complete Renderer Chromium lane passed 204/204 with two workers and no retries.
- 2026-08-29: The first aggregate gate passed typecheck, lint, architecture,
  dead-code, and reference governance, then rejected the direct helper restoration
  because `pi67-renderer-command-fixture.ts` reached 474 lines over its 460-line
  limit. The cohesive conversation command handler was moved into its own
  self-contained page installer rather than weakening the structure gate.
- 2026-08-29: On the final extracted structure, focused Renderer E2E passed
  23/23, the aggregate source gate passed all governed checks and 3199 tests
  (3 skipped), and the complete Renderer Chromium lane passed 204/204 with two
  workers and zero retries.
- 2026-08-29: Scoped commit `973a0fe` was pushed with clean local/upstream/remote
  parity. Windows Candidate run `33248131097` passed its formal dual-profile
  lifecycle, the exact macOS DMG/ZIP passed packaged smoke, and all three
  existing Feishu file tokens were overwritten and uniquely re-listed.
- 2026-08-29: Ordinary CI run `33248103306` exposed an independent macOS
  packaged-smoke hang after HEIC. Attempt 2 reproduced the same boundary and was
  cancelled after 104 seconds in the smoke step instead of consuming another
  full 35-minute timeout.
- 2026-08-29: Added an independent Playwright close deadline, fail-closed
  forced-termination evidence, non-retrying cleanup, and post-HEIC stage markers.
  Unit tests passed 14/14; lint, typecheck, and structure passed; a real local
  unsigned preview passed every stage and left zero controlled-child residue.
- 2026-08-29: The first aggregate coverage run passed 613/614 files and exposed
  one unrelated Agent Host offline Provider startup-budget failure. Its exact
  isolated rerun passed, and the second complete coverage run passed 614/614
  files with 3200 tests passing, 3 skipped, and unchanged coverage thresholds.

## Closeout

- Final source SHA:
- Changed files:
- Validation completed:
- Validation not completed:
- Remaining risks:
- Commit/push/release state:

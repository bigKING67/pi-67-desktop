# Windows CI parallel validation

Status: active
Owner: Codex
Started: 2026-10-05
Last updated: 2026-10-05

## Goal and acceptance

Reduce the ordinary Windows CI critical path by building once and running the
existing packaged smoke/recovery/UI checks and NSIS lifecycle on isolated runners.
Keep all assertions, timeouts, quick/full selection and fail-closed final gates.
Accept only after exact-source full CI passes and measured total time includes
artifact compression, transfer, setup and extraction. Report runner-minute cost
and single-sample limits, not an unsupported long-term performance claim.

## Delivery boundary

The user prioritized completing CI performance before candidate distribution.
Continue authorized local implementation, scoped commit/push and GitHub CI.
The user subsequently included root-cause fixes for the chat latest-message
viewport failure and Windows shutdown-budget failure. Minimal application and
regression-test changes for those failures are authorized. Prepare a new candidate
only after full CI passes and timing is reviewed; frozen Alpha.44 files cannot
represent changed application inputs. No distribution, paid model requests, user
profile changes, global configuration or artifact cleanup.
Use the canonical checkout; main/origin were clean at `e3426fa7`.

## Baseline evidence and decisions

- Full CI `37293280719`, source `97903e97`, attempt 1: all gates passed; elapsed
  1,161 seconds. Windows job 1,140 seconds, Renderer 625, source 579, macOS 285.
- Windows: setup/dependencies 71 seconds, resource/app build 76, native Electron
  85, packaging 86, hidden smoke 191, recovery 79, UI 33, full NSIS 454.
- Preserve the complete hidden smoke: prior controlled experiments found a
  hidden-state shutdown failure; visible UI alone is not equivalent coverage.
- Do not run installer and other Electron applications on the same desktop.
  A build job produces immutable same-run runtime/installer transports; separate
  jobs consume them. No build-output cache or duplicate application build.
- Bind each transport to source, run, original build attempt, kind, size and
  SHA-256; consumers check the producer's identity digest before extraction.
  Failed-job reruns may use the original build attempt only through its job outputs.
- Keep historical installer reuse valid only when the complete split build and
  smoke prerequisites passed. Missing, duplicate, failed or skipped lanes fail closed.
- Transport artifacts expire after one day; existing failure evidence retains its
  current policy. They do not become candidate or release artifacts.

## Checkpoints and validation

- [x] Read live Git, timing, prior experiments and validation contracts.
- [x] Implement transport identity and split CI; preserve legacy reuse and gate semantics.
- [x] Pass artifact corruption/source/attempt tests, gate/reuse/routing regressions,
  lint, structure, workflow pins and PowerShell validation.
- [ ] Push scoped source and validate one full exact-SHA Windows/macOS CI run.
- [ ] Compare complete elapsed time, runner seconds, transfer size and all receipts;
  keep only a demonstrated improvement, or revert the experiment with evidence.

## Rollback and limitations

Revert only this task's scoped changes if transport overhead removes the benefit
or isolated jobs weaken evidence. Retain previous successful candidate files and
all failure receipts; no history rewrite. More runners can reduce elapsed time
while increasing total runner usage; record both. Hosted Windows does not replace
the separate manual candidate acceptance.

## Local validation checkpoint

- Nine focused files / 107 tests passed, including real tar roundtrips and
  corruption, source/run/attempt/version/kind mismatch, occupied destination,
  split-job failure and legacy reuse admission. No application inputs changed.
- Type-aware lint, structure, Action pins (138 references), PowerShell discovery
  (73 scripts), CLI gate success/skip checks and whitespace checks passed.
- Full local source attempt first exposed two unnecessary exports, removed.
  The next run passed 6,407 tests with 24 skips and failed only an existing workflow
  slicing assertion that still treated `native-windows` as the first Windows job.
  Updated its boundary to `windows-build`, preserving all assertions, and included
  that file in the passing focused suite. Full aggregate/coverage acceptance now
  requires the forthcoming clean exact-source CI; do not label the local failed
  aggregate run as passed.
- The diff classifier selects all platforms and `full` NSIS, enabling comparison
  against the full baseline without omitting reinstall. No dispatch override needed.

## First exact-source CI checkpoint

- Implementation `eaeb500ce824420630799a8e573110da629c1818` was scoped, committed
  and pushed. Full CI `37313169801`, attempt 1, completed **FAIL**; the final gate
  correctly rejected two failed validation lanes. Do not mark acceptance complete.
- Source quality passed: 6,408 tests, 24 skips, zero failures; line coverage 87.97%.
  Both transport identities verified on separate Windows runners. Build, complete
  hidden smoke, all three Windows recovery cases, all macOS native checks, and full
  NSIS install/reinstall/dual-profile/uninstall/data-retention checks passed.
- Both platforms' recovery receipts retain clean exact-source identity, unchanged
  canonical profiles, successful owned-process cleanup and zero real model requests.
  Packaged ASARs still match the frozen Alpha.44 candidate byte-for-byte.
- Observed workflow elapsed: 826 seconds versus baseline 1,161; Windows runner
  sum: 1,178 versus 1,140 seconds. This failed-run comparison is **not** accepted
  performance evidence: Windows UI stopped early and full installer execution
  fell from 454 to 307 seconds on a different hosted runner. Do not attribute the
  entire difference to parallel scheduling or claim a stable percentile.
- Transport: 866,772,333 compressed bytes total, one-day retention; producer
  preparation/upload 49 seconds, runtime download/restore 32, installer 29.
  Evidence: ignored `artifacts/validation/ci-parallel-windows/comparison.json`,
  exact run metadata, downloaded receipts, failure screenshot and trace.

### Acceptance blockers and scope decision

1. Renderer E2E: 298 passed, one intentional skip, one failure. After opening older
   chat search history, "jump to latest" loaded message 400 but left it outside
   the viewport; the failure screenshot ends at message 398. Ten bounded local
   repetitions of this unchanged test passed without retries; root cause remains
   unverified. Do not weaken the viewport assertion or label the CI failure flaky.
2. Windows packaged UI: scale 1.5 process exit measured 5,771.2 ms against the
   unchanged 5,000 ms contract. Main reported 1,998.1 ms for its shutdown stage,
   graceful Host exit, and a missing Renderer checkpoint; all tracked processes
   eventually exited. The exact cause of the extra exit latency is unverified.

No product source, test assertions, deadlines or retries were changed in the first
experiment. The user then authorized including both root-cause fixes and preparing
a new candidate after full CI passes. Preserve the failed run as evidence, first
establish reproducible causes, and keep existing assertions and budgets. No blind
CI rerun or distribution.

## Authorized failure remediation

- Chat: default Virtuoso measurement rounds each row, but the product's 14px /
  1.75 line-height produces fractional row heights. Latest navigation also used
  implicit start alignment. Preserve actual bounding-rectangle height and use
  explicit `LAST` / end alignment for initial latest pages and later scroll requests.
  Search focus stays centered; previous-history follow policy is unchanged.
- Controlled regression with a latest message taller than the viewport: original
  source leaves its end 708.5px below the viewport; end alignment alone still leaves
  4.5px clipped; end alignment plus fractional measurement passes. Short and long
  latest-message tests passed three repetitions without retry; full Chat/search
  E2E passed 15 tests. No timing sleeps or relaxed viewport assertion were added.
  The original short-message CI timing failure remains preserved separately.
- Windows: Playwright 1.61.1 launches Electron through a Shell on Windows; four
  Windows lifecycle/UI callers passed `application.process().pid` as Main, unlike
  the existing ordinary smoke. All now capture `process.pid` inside Electron Main.
  UI evidence records driver PID separately. The 5,000ms product and 15,000ms
  driver limits remain unchanged; fresh Windows evidence is still required to
  determine whether the prior 5,771.2ms Shell observation masked a product delay.
- Local full source check passed 6,408 tests / 24 skips and all gates, line coverage
  87.98%; targeted shutdown/layout tests passed 24. Frontend route L1-F, normal risk,
  main serial; actual skills design-craft and browser67, existing DESIGN authority.
  Real Chrome synthetic-fixture navigation reached the 1,494.5px-tall message's end
  in both themes with zero bottom scroll gap. Dark measurement was visible; Light
  was a DOM/geometry check, not a screenshot/visual claim. One managed tab was
  closed and verified, zero remaining; user tabs preserved. Bounded receipt:
  `/tmp/pi67-ci-chat-20261005-browser.json`. No new layout, tokens or primitives.

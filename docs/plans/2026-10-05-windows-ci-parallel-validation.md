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
No application/dependency changes, candidate replacement, distribution, paid
model requests, user profiles, global configuration or artifact cleanup.
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

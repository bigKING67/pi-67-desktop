# Alpha.33 R2 release

Status: published; Windows target upgrade failed; remediation moved to Alpha.34 candidate
Owner: root agent
Started: 2026-08-26
Last updated: 2026-08-26

## Goal

Publish `0.1.0-alpha.33` through the internal unsigned R2 channel from one exact
`main` source SHA. The release includes the committed scoped t3code mechanisms,
the mutable-manifest cache fix, and the Windows update lifecycle repair that pins
the existing installation, relaunches the new version, and preserves a valid
Desktop shortcut. The post-publication target result below records where that
intended Windows lifecycle did not hold.

## Non-goals

- Do not overwrite Alpha.32 immutable artifact names or bytes.
- Do not create a Git tag, GitHub Release, signed release, or public promotion.
- Do not sign or notarize the artifacts.
- Do not delete Alpha.31 or Alpha.32 artifacts before exact Windows and macOS
  programmatic upgrades pass and cleanup receives separate authorization.
- Do not persist R2, GitHub, or Feishu credentials in Git or release evidence.

## Acceptance criteria

- All eight workspace manifests report `0.1.0-alpha.33` on a clean `main` source
  equal to `origin/main`.
- The full repository gate passes for the exact release source.
- Windows Candidate builds from that exact SHA, passes hosted gates, and its x64
  NSIS EXE receives real Windows manual acceptance.
- macOS arm64 DMG/ZIP build from the same source and pass exact packaged smoke.
- R2 plan reports no immutable conflicts or unknown objects; publish verifies all
  three public artifacts before switching the manifest last with `no-store`.
- An installed Alpha.32 Windows copy updates through the app, remains in the same
  installation directory, automatically starts Alpha.33, and provides a working
  Desktop shortcut.
- An installed Alpha.32 macOS arm64 copy updates and restarts as Alpha.33.

## Delivery boundary

- Local implementation: explicitly authorized on 2026-08-26.
- Commit: explicitly authorized for all current uncommitted Alpha.33 content.
- Push: authorized as part of continuing the exact Alpha.33 publication.
- Candidate build/upload: authorized as part of continuing the exact Alpha.33
  publication; target-machine acceptance remains an evidence gate.
- R2 upload: explicitly authorized for exact `0.1.0-alpha.33`, subject to the
  candidate and public-readback gates.
- Tag/release/promotion: excluded.
- Old-version deletion/cache purge: excluded until separate post-upgrade approval.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | The scoped t3code commit `541e7181b1e0bc94caf5af664c1205acf3163c02` and Alpha.33 preparation commit `6842f36a1351042859f7e43eccaafde0fedfa866` were pushed to `origin/main`. | live Git and push receipt | 2026-08-26 |
| OBSERVED | The public Alpha.32-to-Alpha.33 in-app update replaced the installed application with Alpha.33, then exited without relaunching it and removed or invalidated the Desktop shortcut. Alpha.33 remained launchable from the installation directory. | real Windows x64 target-machine execution and screenshots | 2026-08-26 |
| OBSERVED | The failing hop was controlled by the installed Alpha.32 updater, whose installer arguments were only `--updated /S`; Alpha.33's added `--force-run` and pinned `/D=` could not affect the already-running Alpha.32 source side. | exact Git history and updater source | 2026-08-26 |
| OBSERVED | The hosted Alpha.32-to-Alpha.33 lifecycle gate invoked the installer only with `/S /D=...` and then launched the application itself, so it did not verify the real update arguments, automatic post-install relaunch, or Desktop shortcut continuity. | lifecycle harness source | 2026-08-26 |
| OBSERVED | The current local remediation always repairs the Desktop shortcut after an update and makes the Windows lifecycle gate invoke `--updated --force-run /S /D=...`, observe the automatically launched main process, verify the shortcut target, and fail if the observed process cannot be cleaned up. | NSIS include, lifecycle harness, focused tests, and local quality gates | 2026-08-26 |
| OBSERVED | The mutable R2 manifest now carries `Cache-Control: no-store`; local release tooling has a regression test for future manifest writes. | live public headers and release tooling tests | 2026-08-26 |
| OBSERVED | The complete repository gate passed before the Alpha.33 version bump with 589 test files, 3,047 passing tests, and 3 skipped. | `corepack pnpm run check` exit 0 | 2026-08-26 |
| OBSERVED | The exact `6842f36a` source passed the complete repository gate with 595 test files, 3,086 passing tests, and 3 skipped; its macOS arm64 DMG/ZIP were rebuilt and packaged smoke passed. | `corepack pnpm run check` and `preview:mac:unsigned` exits 0 | 2026-08-26 |
| OBSERVED | Windows Candidate `32943391827/1` built and passed packaged smoke/UI/identity, then failed while inspecting the installed Alpha.32 baseline because the current fixture required Alpha.33-only HEIC assets from Alpha.32. | GitHub Actions job `98100934560`, lifecycle summary, exact failed log | 2026-08-26 |
| OBSERVED | Commit `a04b684148b9136914856d7b787334f1735651ce` versions the cross-release packaged-asset contract; exact Candidate `32944754809/1` then passed provenance, packaged smoke/UI, Alpha.32-to-Alpha.33 NSIS lifecycle, dual-Profile recovery, and uninstall gates. | live Git and GitHub Actions jobs `98103015708`, `98103167720`, `98105485674` | 2026-08-26 |
| OBSERVED | The user accepted the exact Alpha.33 Windows candidate; the operator receipt binds that conclusion to run `32944754809/1`, candidate identity `b07c2cbd...`, installer SHA-256 `98ce183e...`, and source `a04b684...`. | current user confirmation and generated credential-free receipt | 2026-08-26 |
| OBSERVED | The credentialed R2 plan reported Alpha.32 public, three Alpha.33 uploads, zero immutable conflicts, and zero unknown objects. Publication uploaded and publicly verified all three versioned files before switching the manifest last. | R2 plan and publish receipt `2026-08-26T08-36-22.711Z` | 2026-08-26 |
| OBSERVED | The public manifest advertises Alpha.33 with `Cache-Control: no-store`; all three artifact endpoints return Range `206` with the manifest byte counts. | bounded public HTTP readback | 2026-08-26 |

## Affected boundaries

- Modules/processes: Desktop updater, NSIS packaging, Renderer/Pi Runtime and
  Worktree/attachment mechanisms already committed in `541e7181`.
- Protocol or persisted state: protocol revision and resource projections from
  `541e7181`; no additional updater persistence migration.
- Platform/artifact: Windows x64 NSIS EXE and macOS arm64 DMG/ZIP.
- Security/privacy: exact artifact identity, repository-external release
  credentials, bounded HEIC normalization, and explicit Worktree effects.
- Existing WIP: all current tracked modifications are explicitly included; no
  unrelated untracked files remain at plan creation.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Release as Alpha.33 rather than overwrite Alpha.32. | R2 artifact names are immutable and Alpha.32 is already public. | None; Alpha.32 bytes must remain immutable. |
| Bind Windows NSIS `/D=` to `dirname(process.execPath)`. | Live evidence showed application and shortcut continuity cannot rely only on installer registry state. | A verified updater API supplies an equivalent exact-install authority. |
| Recreate the Desktop shortcut after every in-app update. | A broken prior update can erase the shortcut before the next installer starts, so conditional preservation cannot distinguish damage from intentional removal. A reliable post-update launch path takes priority. | A durable explicit user preference is added for suppressing shortcut recreation. |
| Retain Alpha.31 and Alpha.32 through target upgrades. | They are recovery baselines until the new lifecycle is proven. | Both target upgrades pass and cleanup is separately authorized. |

## Checkpoints

- [x] 1. Commit every current modification with Alpha.33 version metadata and
  prove clean `main` equals `origin/main` after push.
- [x] 2. Run the exact-source full gate and build/verify macOS arm64 artifacts.
- [x] 3. Build the exact-SHA Windows Candidate and obtain real Windows acceptance.
- [x] 4. Prepare and credential-check the R2 bundle; ensure the read-only plan has
  no conflict or unknown-object blocker.
- [x] 5. Upload immutable artifacts, verify public bytes/hashes/Range, and publish
  the `no-store` manifest last.
- [ ] 6. Verify Alpha.32-to-Alpha.33 in-app upgrades on Windows x64 and macOS arm64.
  Windows failed: files reached Alpha.33, but automatic restart and shortcut
  continuity failed. macOS remains unverified.
- [x] 7. Record publication closeout and leave old-version cleanup pending separate
  approval.
- [x] 8. Repair the local Windows lifecycle contract so the hosted gate uses the
  real update handoff and hard-gates automatic relaunch plus shortcut target.
- [ ] 9. Ship the remediation only as a new immutable version, then verify the
  installed Alpha.33-to-new-version path on real Windows x64 before acceptance.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | `corepack pnpm run check` on exact source | every required gate exit 0 | passed on Alpha.33 source; 595 files, 3,086 passed, 3 skipped |
| Tests | updater/NSIS/release tests and full coverage | lifecycle flags, destination, shortcut, no-store | remediation focused tests 25/25; typecheck, lint, and structure pass; 50% worker coverage passes 595 files and 3,086 tests with 3 skipped; default full concurrency remains flaky on unrelated 5-second Git fixture and Provider startup budgets |
| Runtime/host | packaged smoke on both candidates | exact artifact startup and runtime receipts | passed on hosted Windows x64 and local Apple Silicon macOS |
| Packaged artifact | candidate identity and R2 bundle verification | version/source/size/SHA-256 binding | passed for the exact three-file Alpha.33 bundle |
| Target OS/manual | Windows/macOS installed in-app upgrades | before/after versions and lifecycle | Windows Alpha.32-to-Alpha.33 failed restart and shortcut continuity; macOS pending |

## Rollback

Before the Alpha.33 manifest switch, leave the public Alpha.32 manifest and all
older files unchanged. If post-publication verification fails, restore the
previous manifest before any object cleanup. Never overwrite a versioned file;
preserve failed candidate bytes and credential-free receipts for diagnosis. Any
manifest rollback is a separately authorized external mutation and does not repair
clients that already installed Alpha.33 or change the source-side Alpha.32 updater.

## Risks and unknowns

- Alpha.33 remains public while its Windows source-side update hop is known not to
  relaunch automatically or preserve the Desktop shortcut. No rollback or
  replacement publication is authorized in this remediation step.
- The local repair has only source and focused-test evidence. It requires a new
  immutable version, an exact Windows Candidate, and a real installed
  Alpha.33-to-new-version in-app upgrade before it can be called fixed in release.
- Clients that cached an older mutable manifest before `no-store` may still need
  cache expiry; new responses prevent recurrence but cannot evict existing bytes.
- Alpha.31 and Alpha.32 remain intentional rollback artifacts; cleanup is still
  unauthorized until both post-publication target upgrades pass.

## Progress log

- 2026-08-26: User authorized exact Alpha.33 publication and committing all
  current work. Live Git found completed local commit `541e7181` plus the updater
  and R2 release-tooling remediation; all eight manifests were moved to Alpha.33.
- 2026-08-26: Pushed `541e7181` and `6842f36a`; exact-source full gate and macOS
  packaging passed. Windows Candidate `32943391827/1` stopped before producing a
  testable candidate because its cross-version fixture applied Alpha.33 HEIC asset
  requirements to the installed Alpha.32 baseline. The fixture now versions that
  contract from Alpha.33 onward before rebuilding both exact-source candidates.
- 2026-08-26: Pushed harness repair `a04b6841`; replacement Candidate
  `32944754809/1` passed all hosted gates and received exact Windows manual
  acceptance. Generated the bound receipt and verified the three-file Alpha.33 R2
  bundle.
- 2026-08-26: The read-only R2 plan found no conflicts or unknown objects. Publish
  uploaded and publicly re-read the Windows EXE and macOS DMG/ZIP, switched the
  Alpha.33 manifest last, and wrote receipt `2026-08-26T08-36-22.711Z`. Independent
  public checks confirmed manifest `no-store` and Range `206` for all three files.
- 2026-08-26: The first publish invocation stopped during local flag parsing before
  any R2 write because pnpm forwarded a standalone `--`; the documented publish
  and cleanup examples now use the verified argument form.
- 2026-08-26: Real Windows x64 post-publication testing disproved the hosted
  lifecycle conclusion: Alpha.32 installed Alpha.33 but did not relaunch it and
  left no usable Desktop shortcut. Git history showed that the source-side
  Alpha.32 runner lacked `--force-run` and pinned `/D=`. The hosted gate also used
  direct silent installation plus a test-controlled launch rather than the real
  update handoff. Local remediation now restores the shortcut unconditionally and
  hard-gates the real update arguments, automatic relaunch, and shortcut target.
- 2026-08-26: The remediation passes focused updater/lifecycle tests 25/25,
  typecheck, lint, structure, and `diff --check`. The complete 595-file coverage
  suite passes with 50% workers (3,086 passed, 3 skipped). Two default-concurrency
  runs reached coverage but timed out on unrelated five-second Git fixture and Pi
  offline Provider startup budgets; those files pass in isolation, so the standard
  default-concurrency `check` invocation is not recorded as fully green.

## Closeout

- Published Alpha.33 application source SHA:
  `a04b684148b9136914856d7b787334f1735651ce`
- The Alpha.34 Candidate carries the NSIS shortcut repair, Windows lifecycle
  process harness, lifecycle tests, this plan correction, and the R2 update
  contract; generated installers, receipts, manifests, and logs remain ignored.
- Validation completed: full source gate, exact Windows/macOS packaging, Windows
  Candidate lifecycle and manual acceptance, R2 bundle verification, immutable
  upload, full public readback, manifest-last switch, cache header, and Range
  checks for published Alpha.33; local remediation focused tests, typecheck, lint,
  structure, and reduced-worker full coverage.
- Validation failed: installed Alpha.32-to-Alpha.33 Windows x64 automatic restart
  and Desktop shortcut continuity. The macOS arm64 in-app upgrade remains
  unverified.
- Remaining risks: Alpha.33 public Windows update experience; local remediation
  lacks exact Windows artifact and target-machine proof; pre-existing cached
  Alpha.32 manifests; rollback cleanup remains pending.
- Commit/push/release state: Alpha.33 application source and release tooling were
  published from `a04b6841`; the Windows remediation is versioned for the
  separately authorized Alpha.34 Candidate. No Alpha.34 R2 mutation, Tag, GitHub
  Release, promotion, signing, notarization, deletion, or cache purge is
  authorized by this remediation step.

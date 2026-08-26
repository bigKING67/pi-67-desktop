# Alpha.34 Windows candidate

Status: complete
Owner: root agent
Started: 2026-08-26
Last updated: 2026-08-26

## Goal

Build one exact-source `0.1.0-alpha.34` Windows x64 Candidate that repairs the
failed Alpha.32-to-Alpha.33 update experience. The hosted Alpha.33-to-Alpha.34
NSIS lifecycle must exercise the real update handoff, observe automatic launch,
and verify that the Desktop shortcut targets the updated executable.

## Non-goals

- Do not upload Alpha.34 to R2 or switch the public update manifest.
- Do not upload the candidate to Feishu or delete any existing remote artifact.
- Do not create a Git tag, GitHub Release, promotion, signature, or notarization.
- Do not claim real Windows acceptance from hosted Windows evidence.
- Do not build or publish the macOS Alpha.34 artifacts in this candidate step.

## Acceptance criteria

- All eight workspace manifests report `0.1.0-alpha.34`.
- Local source gates pass for the exact scoped candidate content.
- One scoped commit on `main` contains only the authorized remediation, release
  evidence correction, Alpha.34 metadata, and this plan; it is pushed to
  `origin/main` before workflow dispatch.
- The `Windows candidate` workflow builds the exact full source SHA using
  Alpha.33 Candidate `32944754809/1` at source `a04b684148b9136914856d7b787334f1735651ce`
  as its previous-version baseline.
- Provenance, packaged smoke/UI, candidate identity, and the full Windows NSIS
  lifecycle all pass. The lifecycle report records the real update arguments,
  automatic post-install launch, and a valid Desktop shortcut target.
- The successful `windows-candidate-<run-id>-<attempt>` artifact is downloaded
  and its version/source/size/SHA-256 identity is verified locally.
- Real installed Alpha.33-to-Alpha.34 Windows x64 acceptance remains pending the
  user's target-machine test and is not inferred from the workflow.

## Delivery boundary

- Local implementation: authorized by the user on 2026-08-26.
- Commit: explicitly authorized for the Alpha.34 Windows remediation candidate.
- Push: authorized as the necessary exact-source step of the requested hosted
  Alpha.34 Windows Candidate build.
- Candidate build/upload: authorized for the GitHub Actions Candidate artifact;
  local download and identity verification are included.
- Feishu/R2 upload, manifest switch, cleanup, Tag, Release, signing, notarization,
  and promotion: excluded.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | `main` and `origin/main` both point to `5ea67aa7fec974105010657230465d6151469dd6`; seven known remediation paths are dirty and no unrelated WIP is present. | live Git | 2026-08-26 |
| OBSERVED | The public Alpha.32-to-Alpha.33 Windows update installed Alpha.33 but failed automatic relaunch and Desktop shortcut continuity. | real Windows x64 user evidence | 2026-08-26 |
| OBSERVED | The source-side Alpha.32 updater passed only `--updated /S`; the Alpha.33 target could not alter that already-running hop. | exact Git history | 2026-08-26 |
| OBSERVED | Current local remediation always restores the update shortcut and makes the hosted lifecycle use `--updated --force-run /S /D=...`, observe the automatically launched main process, validate the shortcut target, and fail closed on cleanup. | current source and tests | 2026-08-26 |
| OBSERVED | Alpha.33 Candidate `32944754809/1` was built from `a04b684148b9136914856d7b787334f1735651ce` and remains the exact previous-version workflow baseline. | live workflow contract and Alpha.33 release evidence | 2026-08-26 |
| OBSERVED | Final attempted source `e254c38155eb99cbca9a65d534874568b4ea4b8a` is pushed with `main == origin/main`; run `32954970758/1` passed provenance, packaging, packaged smoke/UI, candidate identity, and exact Alpha.33 baseline verification. | live Git and GitHub Actions | 2026-08-26 |
| OBSERVED | Run `32954970758/1` installed and launched Alpha.33 and observed the simulated missing shortcut, but the lifecycle harness then failed while parsing space-joined PowerShell process-detection statements. It did not verify automatic relaunch or the repaired shortcut and withheld the testable Candidate. | exact lifecycle diagnostic artifact and failed job log | 2026-08-26 |
| OBSERVED | The user resumed the blocked Candidate flow. The next attempt must first execute the process-discovery command in the workflow's Windows helper-test stage, before the full installer lifecycle. | current authorization and workflow order | 2026-08-26 |
| OBSERVED | Run `32957178689/1` passed provenance and the complete build/package evidence, then stopped in the intended Windows helper-test stage because the new PowerShell/CIM execution exceeded Vitest's default 5-second test timeout. The production probe retains its separate 15-second child-process timeout; no lifecycle or Candidate upload ran. | exact failed helper-test log | 2026-08-26 |
| OBSERVED | Run `32958302320/1` passed the real Windows process probe, exact candidate and baseline identity, installed Alpha.33, removed its shortcut, installed byte-exact Alpha.34, and automatically launched the updated process. The recreated `π.lnk` existed but exposed an empty target, so certification stopped before the remaining lanes and withheld the Candidate. | exact lifecycle summary and failed job log | 2026-08-26 |
| OBSERVED | Final run `32960108896/1` at source `7a56fae25121f76ac09d01997064b1cdf1e5e982` passed provenance, Windows build/package evidence, all 53 Windows helper tests, candidate and exact Alpha.33 baseline identity, baseline install/launch, missing-shortcut observation, byte-exact Alpha.34 installation, and automatic updated-process launch. The recreated `π.lnk` still exposed an empty target after direct executable binding, so certification withheld the Candidate. | live Git, exact workflow jobs, and lifecycle diagnostic summary | 2026-08-26 |
| OBSERVED | The user resumed the blocked flow, and the exact failed-run Alpha.34 build artifact `windows-candidate-build-32960108896-1` plus the exact Alpha.33 baseline remain available. The next run will reuse those bytes, preserve the generated link, and compare `WScript.Shell` with `Shell.Application` against both the Unicode original and an ASCII-named byte copy; it will not rebuild the application. | live GitHub Actions artifact inventory and current verifier diff | 2026-08-26 |
| OBSERVED | Lifecycle-only run `32969170526/1` reused and reverified the exact Alpha34 and Alpha33 artifacts. Its preserved 3,079-byte `π.lnk` (`ecf52527...dde563`) resolved to the complete installed executable through `Shell.Application` for both the Unicode original and an ASCII-named byte copy. `WScript.Shell` alone returned empty for `π.lnk` and replaced the copied link's Chinese target segment with question marks. The prior certification failure is therefore a Unicode-unsafe verifier false negative, not a malformed Alpha34 shortcut. | exact dual-resolver JSON, preserved link bytes, and workflow log | 2026-08-26 |
| OBSERVED | Lifecycle-only run `32970084606/1` passed the complete Alpha33-to-Alpha34 cross-version lifecycle with automatic launch, a valid repaired shortcut, both three-restart Profile lanes, uninstall, and user-data preservation. | exact hosted Windows lifecycle summary | 2026-08-26 |
| OBSERVED | Final Candidate `32971119431/2` at source `f50a44429ddaefe5ef28a8edeff3a8b255e71853` passed provenance, build/package, packaged smoke/UI, exact identities, all Windows helper tests, and the full lifecycle. Attempt 1 exceeded the unchanged 5-second shutdown budget once at 5,438ms; the exact failed certification rerun passed without a source or contract change. | live GitHub Actions jobs and both lifecycle summaries | 2026-08-26 |
| OBSERVED | Standard artifact `windows-candidate-32971119431-2` was downloaded locally and reverified as Alpha34 Windows x64 from source `f50a4442`; the installer is 273,793,797 bytes with SHA-256 `ff155c7a...ffc2ff`, and the local candidate verifier fingerprint is `cf9deca9...ad257e`. | exact downloaded artifact, identity file, local verifier, `stat`, and SHA-256 readback | 2026-08-26 |

## Affected boundaries

- Modules/processes: NSIS installer include and Windows installer lifecycle
  harness; no Agent Runtime, Renderer, Provider, or protocol behavior change.
- Protocol or persisted state: none.
- Platform/artifact: Windows x64 unsigned NSIS Candidate only.
- Security/privacy: synthetic runner profile and credential-free artifact
  identity; no user Profile or production credential access.
- Existing WIP: all seven pre-version-bump paths belong to this remediation; no
  unrelated WIP is admitted.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Use Alpha.34 as a new immutable version. | Alpha.33 is already public and its bytes must not be overwritten. | None. |
| Use the exact Alpha.33 Candidate as the hosted upgrade baseline. | The next-hop behavior must prove the installed Alpha.33 source updater and Alpha.34 target installer together. | The baseline artifact fails exact identity verification. |
| Recreate the Desktop shortcut on every in-app update. | A missing shortcut may be damage from an earlier broken update; preserving a reliable launch path takes priority. | A durable explicit suppression preference is implemented and verified. |
| Bind the recovered shortcut directly to `$INSTDIR\${APP_EXECUTABLE_FILENAME}`. | The direct installed path is simpler than the mutable `$appExe` value, matches electron-builder's own launch fallback, and exact Shell inspection resolves it to the byte-exact installed executable. | Exact link inspection identifies a different canonical target or proves the direct binding harmful. |
| Use `Shell.Application` as shortcut-target certification authority and retain `WScript.Shell` only as comparative diagnostics. | Exact Windows evidence shows the former resolves the Unicode link name and localized target correctly, while the latter returns an empty or lossy result for the same bytes. | A native Unicode shell-link resolver disagrees with `Shell.Application` on the exact preserved link. |
| Stop at a verified Candidate. | Hosted evidence cannot replace the user's installed Windows x64 upgrade. | The user separately accepts the exact Candidate and authorizes R2 publication. |

## Checkpoints

- [x] 1. Update all eight manifests to Alpha.34 and pass local source gates.
- [x] 2. Create one scoped commit and prove the committed tree contains only the
  authorized Alpha.34 candidate content.
- [x] 3. Push the exact commit to `origin/main` and verify branch equality.
- [x] 4. Dispatch and monitor the exact-source Windows Candidate workflow using
  the exact Alpha.33 baseline.
- [x] 4a. Pass the Windows process-discovery syntax regression and complete a
  new exact-source certification run; record its shortcut-target blocker.
- [x] 4b. Distinguish an actually malformed link from a Unicode-path
  `WScript.Shell` inspection failure before another full Candidate build.
- [x] 5. Download the successful Candidate artifact, verify its bound identity,
  and record the Windows manual-test handoff without publishing it.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | version scan, `git diff --check`, typecheck, lint, architecture, dead-code, references, structure, transport, and workflow checks | eight Alpha.34 manifests and zero source gate failure | passed; standard `check` reached coverage and only an unrelated 5-second Git fixture timed out under full concurrency |
| Tests | updater/lifecycle tests and full coverage | update args, relaunch, shortcut, and repository regression gates | prior focused candidate/update tests 29/29; resumed workflow helper suite 52 passed/1 Windows-only execution skipped on macOS; timed-out Git fixture 4/4 in isolation; 50% worker coverage 595 files, 3,086 passed, 3 skipped |
| Runtime/host | Windows Candidate packaged smoke/UI and NSIS lifecycle | exact hosted Windows x64 receipts | passed in `32971119431/2`: automatic Alpha34 launch, valid repaired shortcut, post-upgrade runtime, both three-restart Profile lanes, uninstall, and user-data preservation |
| Packaged artifact | Candidate identity verification and local readback | exact version/source/size/SHA-256 binding | passed: `windows-candidate-32971119431-2`, source `f50a4442`, 273,793,797-byte installer, SHA-256 `ff155c7a1bc22bee17a2f196eda949283eeb8a8ab42425d240f55e3886ffc2ff` |
| Target OS/manual | installed Alpha.33-to-Alpha.34 in-app update | automatic restart and working Desktop shortcut | pending user test |

## Rollback

Before push, leave `origin/main` unchanged if any local source gate fails. After
push, do not rewrite history; repair a failed Candidate in a new scoped commit and
rebuild from the new exact SHA. Do not upload a failed Candidate to Feishu or R2.
Alpha.33 remains the public R2 version until separate publication authorization.

## Risks and unknowns

- PowerShell COM shortcut inspection and NSIS force-run behavior require the
  hosted Windows runner and then real Windows x64 evidence.
- `WScript.Shell` is not reliable for this Unicode shortcut name and localized
  target; certification now uses the independently verified `Shell.Application`
  result and retains comparative evidence.
- The Alpha.33 baseline artifact must still be retained and downloadable by the
  new workflow run.
- A hosted pass proves a controlled synthetic profile, not the user's existing
  desktop, OneDrive redirection, Defender/EDR, or real Pi Profile.

## Progress log

- 2026-08-26: User authorized commit and Alpha.34 Windows Candidate build. Live
  Git confirmed `main == origin/main` at `5ea67aa7` with only the seven known
  remediation paths dirty. GitHub authentication and the exact Alpha.33 baseline
  workflow inputs were verified before versioning.
- 2026-08-26: All eight workspace manifests now report Alpha.34. Focused
  candidate/update tests passed 28/28; typecheck, lint, architecture, dead-code,
  reference, structure, transport, workflow, and `diff --check` gates passed.
  Default full concurrency timed out only the unrelated five-second candidate
  source Git fixture at 5.78 seconds; that file passed 4/4 in isolation, and the
  complete 595-file coverage suite passed with 50% workers (3,086 passed, 3
  skipped). The timeout remains recorded rather than weakening its test budget.
- 2026-08-26: Scoped source commit `1686bf05` was pushed with exact branch
  parity. Windows Candidate run `32952238687/1` built and packaged that exact
  source, but certification failed before shortcut-target evaluation because the
  lifecycle harness appended a Unicode shortcut path directly after PowerShell's
  `-Command` script. The failed run uploaded diagnostics but correctly withheld
  the testable Candidate. Repair keeps PowerShell code and data separate by using
  process-scoped environment variables; a new source commit and run are required.
- 2026-08-26: Repair commit `6b90b55b` passed 28/28 focused tests and type-aware
  lint, reached `origin/main`, and removed the PowerShell parser failure in run
  `32953644192/1`. The lifecycle then stopped on a newly added pre-upgrade
  assertion that required the Alpha.33 shortcut to already target the fixture's
  custom install directory. That contradicts this recovery Candidate's missing
  shortcut scenario and Alpha.33's own successful report did not assert it.
  The final gate explicitly removes and observes the baseline shortcut before
  update, then requires Alpha.34 to recreate a canonically matching target.
- 2026-08-26: Final attempted source `e254c381` passed 29/29 focused tests and
  type-aware lint and was pushed with branch parity. Run `32954970758/1` passed
  provenance, Windows packaging, packaged smoke/UI, exact candidate identity,
  exact Alpha.33 baseline verification, Alpha.33 baseline install/launch, and
  missing-shortcut observation. It then failed because the process-discovery
  PowerShell command joined separate assignments with spaces rather than
  statement separators. Automatic Alpha.34 relaunch, repaired shortcut target,
  subsequent real-user lanes, uninstall, and the final Candidate upload were not
  executed. After three unsuccessful certification runs, work stops at this
  reproducible harness blocker instead of issuing another blind rebuild.
- 2026-08-26: The user explicitly resumed the blocked flow. The repair separates
  the multi-line `Where-Object` predicate from PowerShell's top-level statements,
  delimits those statements explicitly, and adds a Windows-only execution
  regression to the workflow helper-test stage before another full lifecycle.
  The exact seven-file helper suite passed locally with 52 tests passed and the
  Windows-only execution test skipped on macOS; type-aware lint, workflow
  PowerShell discovery, and `git diff --check` also passed.
- 2026-08-26: Exact-source run `32957178689/1` passed provenance, Windows
  packaging, packaged smoke/UI, and candidate build identity. The new helper
  test reached its Windows execution branch but Vitest canceled it at 5.005
  seconds, before the production probe's own 15-second timeout. The regression
  now has a bounded 20-second test budget so success or the production timeout,
  rather than the test framework, is authoritative on the next run.
- 2026-08-26: Exact-source run `32958302320/1` passed the Windows helper probe,
  candidate and Alpha.33 baseline identity, baseline install/launch, byte-exact
  Alpha.34 installation, and automatic post-update launch. Its recovered
  `π.lnk` existed but returned an empty target, matching the user's unusable-link
  symptom. The recovery macro now deletes any stale link, binds directly to the
  installed executable path, and fails explicitly if the target or new link is
  unavailable.
- 2026-08-26: Final exact-source run `32960108896/1` at `7a56fae2` passed all
  53 Windows helper tests, provenance, Windows packaging, packaged smoke/UI,
  exact candidate and Alpha.33 baseline identity, baseline install/launch,
  missing-shortcut observation, byte-exact Alpha.34 installation, and automatic
  updated-process launch. The link still existed with an empty target after the
  direct-target change. This disproves `$appExe` as the decisive root cause but
  does not distinguish actual post-AUMI link corruption from a Unicode-path COM
  inspection failure. No testable Candidate was uploaded; another full build is
  blocked pending narrow dual-resolver/link-artifact diagnostics.
- 2026-08-26: The user resumed the flow. Live artifact inventory confirmed the
  exact failed-run Alpha.34 build and Alpha.33 baseline remain downloadable.
  The existing installer-debug workflow is being extended under its
  verifier-only scope to authenticate the failed Candidate run, reuse both
  exact artifacts, preserve the generated `.lnk`, and inspect the Unicode
  original plus an ASCII-named byte copy through `WScript.Shell` and
  `Shell.Application`. This diagnostic does not rebuild or publish Alpha.34.
- 2026-08-26: Lifecycle-only run `32969170526/1` authenticated and reused the
  exact failed-run Alpha34 bytes and Alpha33 baseline. It preserved the generated
  3,079-byte link with SHA-256 `ecf52527fb065d1e9392e9cd3aecfe803b4c0ef0901897c5986019ad01dde563`.
  `Shell.Application` resolved the complete localized executable target from
  both link names, while `WScript.Shell` returned empty for `π.lnk` and a lossy
  target for its ASCII-named copy. Certification now uses the Unicode-safe Shell
  result; another lifecycle-only reuse run is required, not another package.
- 2026-08-26: Verifier-only run `32970084606/1` reused the same exact Alpha34
  and Alpha33 bytes and passed the full cross-version lifecycle: automatic
  launch, valid repaired shortcut, post-upgrade runtime, both three-restart
  Profile lanes, uninstall, and user-data preservation.
- 2026-08-26: Final Candidate run `32971119431/1` built source `f50a4442` and
  passed all gates through the clean-profile lane, then one existing-profile
  shutdown took 5,438ms against the unchanged 5,000ms contract. The exact
  failed certification job was rerun once without changing source or budget;
  attempt 2 passed the complete lifecycle and uploaded the standard Candidate.
- 2026-08-26: `windows-candidate-32971119431-2` was downloaded to
  `artifacts/candidates/windows-candidate-32971119431-2`. Local identity
  verification, file-size readback, and SHA-256 readback passed. Real Windows
  x64 manual acceptance remains pending; no R2/Feishu upload or publication was
  performed.

## Completed closeout

- Candidate source SHA: `f50a44429ddaefe5ef28a8edeff3a8b255e71853`
- Workflow and artifact: `32971119431/2`,
  `windows-candidate-32971119431-2`
- Installer: `Pi-67-Desktop-0.1.0-alpha.34-win-x64.exe`, 273,793,797 bytes,
  SHA-256 `ff155c7a1bc22bee17a2f196eda949283eeb8a8ab42425d240f55e3886ffc2ff`
- Local verifier fingerprint:
  `cf9deca916bb16dcf6f1dcc9bb4118fce4abfd3db8fc6c5c6e83a8d372ad257e`
- Hosted validation: provenance, packaged smoke/UI, exact Alpha34 and Alpha33
  identities, automatic post-update launch, valid repaired shortcut,
  post-upgrade runtime, clean/existing Profile restart lanes, uninstall, and
  user-data preservation
- Remaining manual boundary: real Windows x64 Alpha33-to-Alpha34 update under
  the user's existing Desktop, OneDrive/Defender/EDR, and default install path
- Publication state: Candidate only; no Feishu/R2 upload, manifest switch, tag,
  release, signing, notarization, cleanup, or promotion

## Historical shortcut-verifier checkpoint

- Final attempted source SHA: `7a56fae25121f76ac09d01997064b1cdf1e5e982`
- Final workflow: `32960108896/1`; provenance and build jobs passed, certification
  failed in the shortcut-target assertion
- Validation completed: local helper/source gates; hosted provenance, Windows
  packaging, packaged smoke/UI, all 53 Windows helper tests, candidate and exact
  baseline identity, baseline install/launch, missing-shortcut observation,
  byte-exact Alpha.34 installation, and automatic updated-process launch
- Validation not completed: a valid repaired shortcut target, remaining
  installed lifecycle lanes, uninstall, successful Candidate artifact
  upload/download, and real Windows x64 Alpha.33-to-Alpha.34 acceptance
- Remaining blocker: the exact `π.lnk` exists but `WScript.Shell` reads an empty
  target with either `$appExe` or the direct installed executable path; retain
  and inspect the link through an independent Windows resolver before changing
  NSIS behavior or rerunning the complete Candidate workflow
- Commit/push/release state: source is committed and pushed with branch parity;
  no testable Candidate, Feishu/R2 upload, manifest switch, tag, release,
  signing, notarization, or publication

## Prior blocked closeout

- Final attempted source SHA: `e254c38155eb99cbca9a65d534874568b4ea4b8a`
- Changed files: eight workspace manifests, NSIS shortcut repair, Windows
  installer lifecycle/process gates and tests, release evidence, and Alpha.33/
  Alpha.34 plans
- Validation completed: local focused tests and source gates; hosted provenance,
  Windows packaging, packaged smoke/UI, candidate identity, exact baseline
  identity, baseline install/launch, and missing-shortcut observation
- Validation not completed: automatic post-update launch, repaired shortcut
  target, remaining installed lifecycle lanes, uninstall, successful Candidate
  artifact upload/download, and real Windows x64 Alpha.33-to-Alpha.34 acceptance
- Remaining blocker: process-discovery PowerShell statements require explicit
  separators plus a Windows syntax-level regression before another full build
- Commit/push/release state: source committed and pushed; three workflow runs
  failed certification; no testable Candidate, Feishu/R2 upload, manifest switch,
  tag, release, signing, notarization, or publication

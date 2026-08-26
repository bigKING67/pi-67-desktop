# Alpha.34 Windows candidate

Status: active
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
| Stop at a verified Candidate. | Hosted evidence cannot replace the user's installed Windows x64 upgrade. | The user separately accepts the exact Candidate and authorizes R2 publication. |

## Checkpoints

- [x] 1. Update all eight manifests to Alpha.34 and pass local source gates.
- [ ] 2. Create one scoped commit and prove the committed tree contains only the
  authorized Alpha.34 candidate content.
- [ ] 3. Push the exact commit to `origin/main` and verify branch equality.
- [ ] 4. Dispatch and monitor the exact-source Windows Candidate workflow using
  the exact Alpha.33 baseline.
- [ ] 5. Download the successful Candidate artifact, verify its bound identity,
  and record the Windows manual-test handoff without publishing it.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | version scan, `git diff --check`, typecheck, lint, architecture, dead-code, references, structure, transport, and workflow checks | eight Alpha.34 manifests and zero source gate failure | passed; standard `check` reached coverage and only an unrelated 5-second Git fixture timed out under full concurrency |
| Tests | updater/lifecycle tests and full coverage | update args, relaunch, shortcut, and repository regression gates | focused candidate/update tests 28/28; timed-out Git fixture 4/4 in isolation; 50% worker coverage 595 files, 3,086 passed, 3 skipped |
| Runtime/host | Windows Candidate packaged smoke/UI and NSIS lifecycle | exact hosted Windows x64 receipts | pending |
| Packaged artifact | Candidate identity verification and local readback | exact version/source/size/SHA-256 binding | pending |
| Target OS/manual | installed Alpha.33-to-Alpha.34 in-app update | automatic restart and working Desktop shortcut | pending user test |

## Rollback

Before push, leave `origin/main` unchanged if any local source gate fails. After
push, do not rewrite history; repair a failed Candidate in a new scoped commit and
rebuild from the new exact SHA. Do not upload a failed Candidate to Feishu or R2.
Alpha.33 remains the public R2 version until separate publication authorization.

## Risks and unknowns

- PowerShell COM shortcut inspection and NSIS force-run behavior require the
  hosted Windows runner and then real Windows x64 evidence.
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

## Closeout

- Final source SHA: pending
- Changed files: pending
- Validation completed: pending
- Validation not completed: real Windows x64 Alpha.33-to-Alpha.34 acceptance
- Remaining risks: target-machine restart and shortcut behavior
- Commit/push/release state: pending Candidate only; no publication authorized

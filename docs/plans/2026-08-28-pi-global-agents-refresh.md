# Pi global AGENTS refresh

Status: complete
Owner: Codex
Started: 2026-08-28
Last updated: 2026-08-29

## Goal

Refresh the canonical Pi global `AGENTS.md` kernel and its browser/product-boundary
rules so Pi TUI and Pi-67 Desktop share the current authorization, runtime,
first-party Search, browser-instance, evidence, and delivery contracts.

## Non-goals

- Do not change the Pi agent loop, Provider behavior, Session format, or Desktop
  product runtime.
- Do not overwrite unrelated `pi-67/mcp.example.json` WIP or the current broad
  Pi-67 Desktop capability/Settings WIP.
- Do not edit generated capability artifacts directly or create a source lock
  that cannot be verified from the canonical remote.
- Do not publish, deploy, upload a candidate, tag, or create a release.

## Acceptance criteria

- [x] The canonical Pi kernel distinguishes Pi runtime authority from the Pi TUI
  and Pi-67 Desktop entrypoints without creating a second harness or Session truth.
- [x] Authorization layers, exact value compass, live-capability routing, and
  truthful completion evidence are explicit in the short kernel.
- [x] Browser routing uses current first-party Search/fetch capabilities, carries
  explicit Browser Instance identity, fails closed on ambiguity/unavailability,
  and scopes cleanup to one instance unless separately confirmed.
- [x] Prompt-governance checks prevent regression to legacy Search routing or the
  former TUI-only product-boundary wording.
- [x] The canonical source changes pass their focused gates and are committed with
  scoped staging while unrelated WIP remains untouched.
- [x] Desktop capability lock/artifact and the existing user-global install are
  updated only after exact provenance, a bounded backup, and the explicit
  TUI-versus-Desktop projection boundary are verified.

## Delivery boundary

- Local source implementation, scoped `pi-67` commits, push to `pi-67/main`,
  exact Desktop lock/artifact refresh, and bounded global synchronization were
  authorized by the user's accepted follow-up recommendation.
- The broad Pi-67 Desktop capability/Settings WIP was committed concurrently as
  local commit `f1319739e24334c996c7344e5e1cedfe6ae76bb8`, outside this task's Git
  actions. This task does not amend, push, or attribute that commit to Codex.
- After all final gates passed, the user separately authorized one scoped local
  Desktop commit containing repository `AGENTS.md`, the final lock/fixture delta,
  and this plan. Push remains outside the authorization boundary.
- Candidate upload, tag, release, promotion, deployment, and publication remain
  outside this delivery.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| VERIFIED | Remote `pi-67/main` is exact SHA `56c13da329b1d4dddc87c4d1655375156baa08e7`; the six-file governance content commit is `bdbd32d283bb505b9ee9f057a33d34ec42a1e280`, followed only by the CRLF-invariant checker fix. | live remote refs and scoped diffs | 2026-08-29 |
| VERIFIED | Canonical source, prepared artifact, packaged app resources, Pi TUI top-level global files, and Desktop namespaced rules match the final kernel/rule hashes. | live SHA-256 and byte comparisons | 2026-08-29 |
| VERIFIED | Desktop catalog `2026.08.29.2` locks `pi67-core` to `56c13da` and AI Berkshire Pack `1.0.8` to `58d09b1`; all tracked capability sources are current, and remote lock verification, capability preparation, regression gates, packaged smoke, and real macOS preview passed. | current lock/artifact/tests/package | 2026-08-29 |
| VERIFIED | A bounded pre-refresh archive and receipt preserve the exact previous global `AGENTS.md` plus two rules. | `~/.pi/agent/pi-global-agents-refresh-backup-20260829T100455+0800.TIg3GF` | 2026-08-29 |
| OBSERVED | The canonical `pi-67` root still preserves unrelated `mcp.example.json` WIP and divergent local history. Desktop contains the earlier concurrent local commit `f131973` plus this plan's separately authorized scoped delivery; both remain unpushed. | live Git status and log | 2026-08-29 |

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Edit `pi-67` source first and never the generated artifact. | The Desktop snapshot is provenance-bound to an immutable source commit. | The capability architecture names a different canonical source. |
| Keep one Pi runtime/harness while allowing TUI and Desktop as first-party entrypoints. | Runtime authority and user entrypoint are different boundaries. | Upstream or product contracts change the runtime ownership model. |
| Keep lock/artifact/global synchronization atomic and provenance-verifiable. | A local-only source commit cannot satisfy the remote exact-lock contract, and bootstrap preserves an existing global kernel as user-owned. | The exact commit becomes remotely reachable and the overlapping Desktop WIP is integrated. |

## Checkpoints

- [x] 1. Audit live source, artifact, installed global, bootstrap ownership, lock,
  and dirty worktrees.
- [x] 2. Update canonical kernel/rules/docs and add regression checks.
- [x] 3. Run focused governance, loader/content, and diff validation.
- [x] 4. Inspect the staged source diff and create one scoped `pi-67` commit.
- [x] 5. Integrate through one temporary worktree, push exact source commits,
  refresh the Desktop lock/artifact, preserve the existing global files in a
  bounded archive, and synchronize both Pi TUI and Desktop rule projections.
- [x] 6. Record the final exact-SHA CI rerun result and remove the temporary
  integration worktree and branch.
- [x] 7. Refresh the stale AI Berkshire Pack baseline through the exact locked
  adapter, prove all capability sources current, and rerun full Desktop gates.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | prompt-governance check, release dry-run, scoped diff, and remote refs | short kernel and new contracts pass at one immutable SHA | `PASS`: governance 50/50, release-check 33 PASS / 1 platform WARN / 0 FAIL, remote main `56c13da` |
| Windows CRLF | simulated CRLF metrics plus exact-SHA Windows PowerShell smoke | character budget is line-ending invariant | `PASS`: raw CRLF 4574 normalizes to 4477; Node 22 full smoke passed and Node 24 logged `PASS Pi prompt governance check passed` |
| Desktop provenance | remote lock verification, prepare, freshness, and catalog inspection | lock and artifact bind to final remote commits | `PASS`: catalog `2026.08.29.2`; 5 remotely fetchable commits verified; 4 packages prepared; all first-party sources and AI Berkshire Pack `1.0.8` are `current` |
| Desktop regression | targeted Vitest, lint, typecheck, full Vitest, isolated Renderer Playwright | source lock, Pack lifecycle, and displayed baseline remain coherent | `PASS`: targeted 8 files / 60 tests; lint and typecheck; full 609 files / 3178 passed / 3 skipped; Renderer 8/8 passed on explicit port `45173` |
| Desktop package | unsigned macOS build, packaged smoke, and preview launch | packaged resources and real Agent Host path carry exact content | `PASS`: complete build and packaged Electron smoke passed; latest app opened with `app.asar` SHA-256 `915f2a6d1bbce5917e52720f9da3ba31ed00efd28fec013d9dcc1b0bbce4539c` |
| Installed global | archive/receipt, bootstrap state, hashes, and byte comparison | no split-brain TUI/Desktop kernel or rule content | `PASS`: TUI top-level and Desktop namespaced rules match source; Desktop state catalog is `2026.08.29.2` |
| Exact-SHA CI | GitHub Actions run `33228543514` | all source lanes pass at the final remote SHA | `PASS`: attempt 2 completed 5/5 jobs; the rerun Windows Node 24 PowerShell job passed in 9m06s |

## Rollback

Revert the two scoped `pi-67` commits if the governance contract regresses, then
refresh the immutable Desktop lock/artifact from the chosen remote commit. Restore
the three TUI-global files from the recorded tar archive independently. Do not
touch `mcp.example.json` or unrelated Desktop WIP.

## Risks and unknowns

- `~/.pi/agent/AGENTS.md` and Pi TUI top-level rules remain user/global-owned;
  Desktop bootstrap updates its namespaced rule projection but does not replace
  those top-level files automatically. Future refreshes need the same explicit
  backup and byte-level synchronization boundary.
- The default local Playwright port `5173` is occupied by the unrelated
  `play67/resume` Vite process and would be reused outside CI. The first E2E
  bootstrap therefore stopped before task assertions; the isolated rerun with
  explicit port `45173` passed all eight tests without touching that process.
- This scoped Desktop delivery and the earlier concurrent local commit `f131973`
  remain unpushed; no push, candidate upload, promotion, or publication is
  authorized by the local commit request.

## Progress log

- 2026-08-28: Audited all three kernel/rule copies, source provenance, bootstrap
  ownership, current product Search/browser contracts, and both dirty worktrees.
- 2026-08-28: Detected new parallel Desktop capability/Settings WIP and narrowed
  implementation to the non-conflicting canonical `pi-67` source.
- 2026-08-28: Committed the six-file canonical source change as
  `84391ef4999b41d8460c3fbf16f0393605483e0a`; unrelated `mcp.example.json`
  remained unstaged. Focused governance and 70 adjacent tests passed.
- 2026-08-28: Live remote `main` remains
  `500f3f63a14d80b0297a1dcc04237b5e2cf87894`; the local branch is ahead 13 and
  behind 1. Stopped before lock/artifact/global writes because they would be
  non-reproducible or create mixed-version installed rules.
- 2026-08-29: User authorized the previously blocked integration/push and global
  synchronization. Integrated the six-file patch as `bdbd32d`, then fixed the
  Windows CRLF budget root cause as `56c13da`; both are on remote `main`.
- 2026-08-29: Refreshed Desktop catalog `2026.08.29.1`, rebuilt the exact
  capability artifact and unsigned macOS preview, synchronized Pi TUI and Desktop
  projections from the same bytes, and preserved the previous global files in a
  bounded verified archive.
- 2026-08-29: Exact-SHA CI run `33227895404` exposed one task-related Windows
  CRLF count bug plus unrelated/transient Hy-Memory failures. The final run
  `33228543514` passed all five jobs after one failed-job rerun; the first attempt
  had only exceeded the 15-minute Windows Node 24 job budget after its task-related
  gates had already passed.
- 2026-08-29: During final verification, an external concurrent process committed
  the previously observed broad Desktop WIP as `f131973`. Re-read live Git state,
  preserved that commit without amendment/push, and left this task's final
  lock/fixture delta plus repository governance files unstaged.
- 2026-08-29: Reviewed AI Berkshire `76aa42f..58d09b1`; the only upstream
  changes are five report files, while `codex-skills/`, `tools/`, and `LICENSE`
  have an empty diff. Refreshed the immutable Pack provenance as routine patch
  `1.0.8`, catalog `2026.08.29.2`, with no Skill additions or removals.
- 2026-08-29: Capability freshness returned `passed` with every package and the
  Skill Pack `current`; complete lint, typecheck, Vitest, isolated Renderer E2E,
  build, unsigned packaging, packaged smoke, Desktop bootstrap, and real macOS
  preview launch all passed. The user then separately authorized one scoped
  local Desktop commit; push, candidate upload, and publication remain outside
  the delivery boundary.

# Review findings remediation

Status: completed locally; Windows execution evidence pending
Owner: Codex
Started: 2026-09-05
Last updated: 2026-09-05

## Goal

修复 ba394cd 上只读审查确认的七项问题，并验证、处理两项 LIKELY 线索。

## Non-goals

不扩展全仓审查范围，不引入新 Harness、Session truth、Provider 或权限体系。

## Acceptance criteria

- rules 项目信任、只读 Git、Memory peer 与预览身份边界有明确拒绝回归。
- Task 切换提交、stash 恢复、文件保存等待期间的新编辑不会误确认或丢失。
- 默认 OpenViking peer 与 Experience 面板异步结果按 Workspace 隔离。
- 必需 CI 执行 PowerShell AST 解析；最小测试与完整 check 通过。
- macOS unsigned preview 完成 package、smoke 和启动；Windows/真实服务端证据独立标记。

## Delivery boundary

- Local implementation: authorized, including regression tests and relevant contracts.
- Commit: not authorized.
- Push: not authorized.
- Candidate build/upload: local macOS preview only; no upload.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | clean main at ba394cd160bf46beba1b7623afc303fc8bfb45f6 | live Git | 2026-09-05 |
| OBSERVED | seven CONFIRMED, two LIKELY; source check passed | rc-20260905T031754Z-3266fda88a48 | 2026-09-05 |
| OBSERVED | canonical fix preparation selects seven actionable findings | rcf-20260905T035907Z-0e6aeddc63aa | 2026-09-05 |

## Affected boundaries

- Modules/processes: workspace resources, Main Git, Host Memory, OpenViking extension, Renderer controllers, CI.
- Protocol or persisted state: preserve existing commands and durable Session truth; transient preview/snapshot ownership may be strengthened.
- Platform/artifact: local macOS arm64 preview; Windows AST source wiring.
- Security/privacy: fixtures only; no real credentials or Memory reads/deletes.
- Existing WIP: none at baseline; preserve unrelated later changes.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Local guards in existing modules | Defects concern ownership at existing boundaries | A regression proves the existing identity insufficient |
| Main owns frontend and integration; two disjoint backend tasks | No shared-file write overlap | Conflicting edits or shared API change |
| LIKELY items require regression evidence | Source suspicion alone does not close a finding | Counterexample proves unreachable |

## Checkpoints

- [x] 1. Implement and verify seven confirmed fixes.
- [x] 2. Validate and resolve two likely findings.
- [x] 3. Integrate contracts and pass full source quality gate.
- [x] 4. Package/smoke/open macOS preview and record evidence.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Tests | affected Vitest suites and isolated regressions | behavior assertions | PASS; 3433 tests passed, 5 skipped in full check |
| Source | corepack pnpm run check | canonical fix attempt | standalone PASS; final immutable capture follows this plan update |
| Runtime/host | synthetic SDK/Host and browser fixture | current workspace ownership | PASS; actual Pi SDK rules fixture and browser67 delayed-response fixture |
| Packaged artifact | corepack pnpm run preview:mac:unsigned | package/smoke/open receipt | PASS on local darwin/arm64; new repository app opened |
| Target OS/manual | Windows AST and real OpenViking server | separate environment | unverified locally |

## Rollback

Revert only this task's scoped edits if needed. Do not reset worktree or alter user sessions,
credentials, remote objects, or unrelated WIP. No persistent data migration is planned.

## Risks and unknowns

Real OpenViking server ACL and Windows runtime remain separate evidence. Tests must preserve
explicit peerId, global rules, provisional Task creation, and current user drafts.

## Progress log

- 2026-09-05: baseline and fix preparation verified; implementation started.

## Closeout

- Source baseline: ba394cd160bf46beba1b7623afc303fc8bfb45f6 plus local uncommitted fixes.
- Changed scope: Renderer controllers and regressions, Host Memory authorization, rules loader, OpenViking peer binding, Main Git status, Windows CI gate, capability catalog 2026.09.05.1 and product/design contracts.
- Validation completed: full source check (675 files passed, 2 skipped; 3433 tests passed, 5 skipped), browser67 real React regression, synthetic real Pi SDK rules probe, macOS unsigned package/smoke/open. Final canonical capture is stored externally under the prepared fix session.
- Validation not completed: target Windows and real server.
- Remaining risks: RC-TEST-001 source wiring is fixed, but its required Windows AST execution receipt remains PARTIAL. Real OpenViking service ACL and Windows packaged behavior remain UNVERIFIED; no remote service operations were performed. This closes the selected remediation scope, not a new exhaustive repository review.
- Commit/push/release state: none authorized.

## Local evidence receipts

- Full source gate: `/tmp/pi67-review-ba394cd/fix-check-2.stdout` and `.stderr` (exit 0).
- Earlier failing source check retained as `fix-check.stdout` / `.stderr`; stale capability hash and overly broad CI command assertion were corrected.
- Actual Pi SDK 0.84.3: `/tmp/pi67-review-ba394cd/rules-trust-fixed.json`; untrusted project rule not injected, no network.
- Experience baseline and fixed browser evidence: `/tmp/pi67-review-ba394cd/experience-browser-baseline.json` and `experience-browser-final.json`; delayed A response no longer overwrites B. Four task-owned tabs closed and verified.
- OpenViking registered Session start regression verifies A-to-B default peer rebinding and explicit peer preservation using synthetic transport; no server claim.
- Independent source review identified same-file overlapping saves; save mutual exclusion and a regression now preserve new content and use the acknowledged revision for the next save.
- Native preview: `/tmp/pi67-review-ba394cd/fix-preview.stdout` and `.stderr` (exit 0); packaged Agent Host startup, sandbox/app scheme, warm/cold Session restore and shutdown smoke passed.
- Opened repository `artifacts/release/mac-arm64/Pi-67 Desktop.app`, pid 22151 at verification time. `app.asar` size 198037171, SHA-256 `3fe3435e29dd78f39c6a4f884c379ce35c048e8a5755ccf874ed35fba4586c92`.
- Canonical fix session: `rcf-20260905T035907Z-0e6aeddc63aa`; final attempt receipt and assessment remain outside Git.
- Frontend route: L1-F functional, PRODUCT/DESIGN authority, design-craft, main-owned implementation; no visual/token changes. Browser runtime evidence is distinct from packaged smoke.

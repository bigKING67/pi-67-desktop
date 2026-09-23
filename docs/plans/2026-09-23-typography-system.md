# Application typography and Markdown refinement

Status: completed
Owner: Codex
Started: 2026-09-23
Last updated: 2026-09-23

## Goal
Unify application typography roles across navigation, transcript, Composer,
Inspector, Settings and dialogs; correct unlabelled block code and table sizing.

## Non-goals and delivery boundary
Keep runtime/protocol, persistence, theme palette, font families and scrolling
policy. Local implementation, validation and unsigned macOS preview only.
No commit, push, upload or release.

## Initial evidence (before implementation)
- main is ahead of origin/main by 11 in the local tracking snapshot; numerous
  prior UI edits remain uncommitted. Preserve all earlier changes.
- 68 Renderer CSS files have dispersed 8–24px sizes and 19 distinct weights.
- No independent font scaling preference found; retain existing window/browser
  zoom behavior and exact virtualized code row metrics.
- Markdown block rendering currently depends on language class, leaving
  unlabelled fences/indented code outside CodeBlock. Tables impose 9rem on every cell.

## Decisions
Use shared caption/support/interface/body/section/heading/title/display sizes,
regular/medium/semibold weights and shared prose/interface line heights.
Minimum readable UI copy is 11px; primary controls use interface role, auxiliary
controls may use support/caption. Relative inline math/code sizing remains relative.
Render block code at the semantic pre node, preserving inline code and full copy.
Use intrinsic table layout with wrapping; wide tables retain their own viewport.

## Checkpoints
- [x] Implement tokens and semantic role audit; update design authorities.
- [x] Fix and regress block-code/table behavior.
- [x] Source gate and representative UI/state/zoom/theme tests.
- [x] Browser visual review and unsigned macOS packaged smoke/relaunch.

## Validation
Completed checks are recorded in Validation receipts and Closeout below.
Windows remains unverified. Browser fixtures, packaged smoke and user-confirmed
manual checks are separate evidence levels.

## Rollback
Revert only this batch's token substitutions, role calibrations and Markdown
changes using scoped diff; preserve pre-existing dirty UI and unrelated WIP.
No data migration or irreversible state change.

## System consistency review

Route: L2, design-craft, main serial. DESIGN.md and DESIGN.dark.md are authority.
Existing React Aria/native controls kept; no primitive or dependency migration.

| Family | Representative states | Evidence | Verdict |
| --- | --- | --- | --- |
| Navigation and titles | selected/unselected, light/dark | workbench screenshots | pass |
| Prose, tables, code | inline/block, unlabelled logs, short/wide columns, copy | Markdown unit + typography/appearance E2E | pass |
| Composer | idle/streaming/rejected submission, desktop/narrow | Composer and responsive E2E | pass |
| Settings | selected category, controls, 1440/1000/720px and 200% equivalent | Settings layout/responsive E2E and light/dark screenshots | pass |
| Dialogs | focus, disabled, invalid, narrow | file-dialog/approval E2E and light/dark screenshots | pass |
| Inspector | file names, metadata, tabs | workbench screenshots | pass |

Source review found no changed virtualized row metrics, process/protocol,
or model behavior. Performance claims are limited to preservation of those
mechanisms and passing streaming regression, not a new benchmark.

## Validation receipts
- Renderer typecheck + Markdown unit: 8 passed, including two block-code regressions.
- Renderer E2E: 51 passed using built preview, 0 retries.
- Real browser67: managed test tab, workbench rendered and inspected, theme switch
  and code-copy focus observed; finalized with closed=1, verified=1, remaining=0.
- Full source first run: 881 files passed, 1 failed, 9 skipped; 5739 tests passed,
  1 failed, 24 skipped. Failure: native-artifact-store symlink retirement test.
  No UI ownership or edits in that file. Its 8 tests passed in a targeted rerun.
  Timestamp ties followed by random-path sorting are a plausible fixture-order
  explanation, not a proven root cause. Full confirmation passed as recorded below.
- Packaged preview passed as recorded below. Native Windows and every possible page/state are
  unverified; representative system review does not claim exhaustive screenshots.

## Closeout

- Full source confirmation passed: 882 files, 5740 tests, 24 skipped; branch
  coverage 78.45%. First-run unrelated failure and targeted pass retained above.
- macOS arm64 unsigned preview rebuilt, packaged smoke passed, app reopened.
  app.asar SHA-256: 8a614916b4f97dd859c76674bbe1b1a0dfefbea9d0c59ae7e74f66ffd2e5706f.
  Identity: artifacts/release/macos-preview-candidate-identity.json (dirty-source preview).
- CUA observed the selected real historical conversation's stopped shell. The
  attempt to open it failed with noWindowsAvailable; rebinding by bundle ID and
  raising the known window did not restore a usable content AX tree. Therefore
  automated native long-conversation interaction was UNVERIFIED, not passed.
- Representative visual system review: pass for browser workbench, settings,
  dialogs and narrow layouts; screenshots under artifacts/visual-review/typography/.
  This browser review did not establish native long-conversation or Windows acceptance.
- No new dependencies, process/protocol changes, persistence, commit, push or upload.
  Earlier dirty work was preserved. The plan records completion of local changes
  and available validation, not exhaustive native acceptance.

## Final refinement and acceptance

- Prose emphasis is 500 beneath 600-weight headings; list spacing is 0.5em.
  Inline-code borders use 35% of the border token. Disabled send uses disabled
  surface/text tokens, with no hover promotion. Both design authorities agree.
- Latest refinement: 28 Renderer E2E checks passed, covering both themes,
  Composer empty/ready/running states, Markdown and narrow layouts.
- Flow acceptance: 29 Renderer E2E checks and 32 activation/draft unit tests passed.
  This includes workspace switching, cold Session restoration, draft protection,
  stop, live-scroll following and Settings reading-anchor restoration.
- Latest macOS arm64 preview passed packaging and smoke and was opened.
  app.asar SHA-256: e05db35b2410b421122e13067f6e08cf3230fe64df61acbcd682d388aa5ad507.
- Computer Use could read the real conversation but did not reliably execute
  switching (coordinate input returned noWindowsAvailable). The user subsequently
  confirmed the requested round trip between the Changsha and live-data diagnosis
  conversations had no problem. This closes that specific manual acceptance gap;
  it is user-confirmed evidence, not an automated pass or exhaustive native audit.
- Full-source receipt above predates the final local CSS refinements; their
  evidence is the targeted E2E and latest packaged smoke, not a new aggregate run.

## Proposed submission boundary (not staged or committed)

- Include the Renderer UI implementation, matching Renderer E2E changes, the six
  packaging readiness-selector updates, both design authorities' UI changes,
  and the three 2026-09-23 UI plans.
- DESIGN.md has mixed ownership: exclude the added design-and-interaction
  reference-guide paragraph near the design principles when staging UI hunks.
- Preserve and exclude AGENTS.md, PRODUCT.md, the prompt-attachment-access test,
  external-references.md, design-interaction-references.md, design-preview/,
  and the 2026-09-17 artifact-retention / 2026-09-20 prototype plans.
- Artifacts, screenshots, package output and logs remain excluded. No dependencies,
  lockfile, process/protocol or private data belong to this UI submission.
- Suggested single cohesive commit: `Polish neutral themes, typography and workbench feedback`.
  The coupled typography tokens and consumers should not be split mechanically.
  Commit and push still require explicit authorization.

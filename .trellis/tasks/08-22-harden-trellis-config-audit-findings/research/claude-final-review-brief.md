# Claude Final Read-Only Review Brief

Active task: `.trellis/tasks/08-22-harden-trellis-config-audit-findings`

Review the final uncommitted remediation as an independent senior engineer.
This is a review-only turn. Use Bash freely for read-only inspection and the
listed verification commands, but do not edit, create, delete, install,
format, stage, commit, push, change permissions, or change configuration.
Report proposed fixes instead of applying them.

## Required scope

1. Read `prd.md`, `design.md`, `implement.md`, `check.jsonl`, every file named
   by the manifest, and the archived audit evidence referenced by the Task.
2. Inspect `git status --short --branch`, the complete tracked diff, and the
   new untracked implementation files. Do not mistake `git diff` alone for
   complete coverage.
3. Check all acceptance criteria, especially:
   - operational stale-reference removal without rewriting generic examples;
   - routing metadata validation on create/set-meta/start;
   - zero pointer/status/hook mutation when start rejects metadata;
   - custom metadata compatibility and valid L1/L2 degraded start behavior;
   - exact development-only Trellis dependency and lockfile/version parity;
   - repo-local live CLI/static/Python gate composition;
   - Relay CLI prerequisite behavior and close fallback wording;
   - no product runtime, packaging, Provider, Renderer, Session-truth, or local
     Claude permission-policy drift.
4. Review tests for false positives, missing negative cases, fragile substring
   assertions, path/OS portability, CI behavior, error observability, and any
   security or dependency-boundary regression.
5. You may rerun `corepack pnpm run check:trellis`, targeted Python tests, and
   other non-mutating inspections. The Codex main session already ran the full
   repository check; do not reinstall dependencies or run packaging/preview.

## Current evidence to verify, not trust blindly

- Base committed `HEAD`: `42e15c29b8d6b47102f64b8e745eb3c8b215dcde` on
  `main`, aligned with `origin/main` before the uncommitted Task work.
- `corepack pnpm run check:trellis`: 16 tests passed, zero skipped.
- Polluted-bucket Relay run: 11 tests passed.
- `corepack pnpm run check`: 581 files passed; 3005 tests passed, 3 existing
  product-suite skips; all preceding repository gates passed.
- `git diff --check`: passed.
- `.claude/settings.local.json` expected SHA-256:
  `6d083d404f610b5023d801d4453152ae22988dac32453dedf0a6a5a54556c052`;
  it must remain ignored and untracked.

## Required report

Return one concise final report only:

- Verdict: `PASS` or `FAIL`.
- Findings ordered P0, P1, P2, P3, each with exact `file:line`, consequence,
  and concrete remediation. Do not invent a finding to fill a category.
- Explicit acceptance-criteria coverage and any unverifiable item.
- Commands actually run and summarized outcomes.
- Final statement whether any unresolved P0/P1/P2 remains.
- Confirm that you made no workspace or external-state changes.

If there are no material findings, say so directly. P3 suggestions may remain
advisory, but any P0/P1/P2 makes the verdict `FAIL`.

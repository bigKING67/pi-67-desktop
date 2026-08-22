# Implementation Plan

## Change Boundary

The smallest behavior gap is that project-local Trellis documentation can
route agents to missing files, Task routing metadata is not validated before
execution, and the repository quality gate does not run the Relay suite. The
behavior lives in Trellis task lifecycle scripts, the Trellis quality gate,
the development-only package manifest, and synchronized workflow references.
Product applications and packages are outside the edit scope.

## Ordered Steps

1. **Baseline and context**
   - Reconfirm `main`, dirty paths, `origin/main` parity, active Task, Relay
     handoff hash, Trellis `0.6.15`, and local Claude settings hash.
   - Load the shared guide index and archived audit verification.

2. **Repair authoritative workflow references**
   - Add `.trellis/spec/guides/workflow-state-contract.md` and index it.
   - Replace dead workflow parser/contract/test references.
   - Update operational `task.py` and `add_session.py` examples.
   - Synchronize the task-lifecycle reference across `.agents`, `.claude`, and
     `.grok`; leave clearly illustrative generic package examples alone.

3. **Implement routing metadata validation**
   - Add `.trellis/scripts/common/task_routing.py`.
   - Validate recognized values in create/set-meta.
   - Gate `task.py start` before pointer, status, or hook mutation.
   - Add focused unittest coverage for valid, missing, invalid, custom, and
     degraded-session cases.

4. **Make Trellis gate executable and reproducible**
   - Add exact dev dependency `@mindfoldhq/trellis@0.6.15` and refresh the
     frozen lockfile using pnpm.
   - Remove Knip's `trellis` binary ignore.
   - Extend `check-trellis-integration.mjs` with dependency/version, live CLI,
     authoritative-path, and synchronized-copy checks.
   - Make `check:trellis` run `--live-cli` plus unittest discovery.
   - Make the Relay test harness resolve the local CLI and fail instead of
     silently skipping.

5. **Fix Relay fallback wording**
   - Use the metadata-missing message when `close` finds no Relay Channel.
   - Add a regression assertion without weakening unavailable-runtime behavior.

6. **Targeted validation**
   - Run Python unittest discovery for all Trellis tests.
   - Run the Relay suite again with inherited project-bucket pollution.
   - Run `corepack pnpm run check:trellis`.
   - Run focused CI classifier, Knip/structure, and workflow tests affected by
     package/gate changes.

7. **Repository validation**
   - Run one complete `corepack pnpm run check` after targeted checks pass.
   - Do not run unsigned preview because no product UI changes.

8. **Independent Claude final review**
   - Snapshot the complete final diff and hashes.
   - Spawn exactly one read-only Claude Channel worker with this Task's
     artifacts, specs, archived audit, exact diff scope, and decisive commands.
   - Wait for `done/error/killed`, inspect raw final output, terminate the
     Supervisor, and confirm no live worker.
   - Main session validates every material finding and reruns decisive checks
     if the review changes the conclusion.

9. **Closeout without external actions**
   - Update acceptance criteria, `research/`, and bounded `handoff.md`.
   - Report changes, tests, Claude verdict, remaining risks, dirty scope, and
     unperformed commit/push/release actions.
   - Do not commit or archive if doing so would create a commit without explicit
     user authorization.

## Expected Edit Scope

- `.trellis/workflow.md`
- `.trellis/spec/guides/{index,workflow-state-contract,trellis-development-workflow}.md`
- `.trellis/scripts/{task,add_session,trellis_relay}.py`
- `.trellis/scripts/common/{task_store,task_routing}.py`
- `.trellis/tests/test_*.py`
- `.agents/skills/trellis-meta/references/customize-local/change-task-lifecycle.md`
- `.claude/skills/trellis-meta/references/customize-local/change-task-lifecycle.md`
- `.grok/skills/trellis-meta/references/customize-local/change-task-lifecycle.md`
- `eng/quality/check-trellis-integration.mjs`
- `package.json`, `pnpm-lock.yaml`, `knip.json`
- current and archived Task coordination artifacts only

## Validation Commands

```bash
python3 -m unittest discover -s .trellis/tests -p 'test_*.py' -q
TRELLIS_CHANNEL_PROJECT=parent-worker-bucket python3 .trellis/tests/test_trellis_relay.py -q
corepack pnpm run check:trellis
corepack pnpm exec vitest run eng/ci/classify-change-scope.test.mjs
corepack pnpm run check:structure
corepack pnpm run check:dead-code
corepack pnpm run check
```

## Rollback Points

- After reference repair: no behavior changed; revert docs together if paths
  cannot be made authoritative.
- After metadata gate: do not proceed if valid current Task start behavior or
  degraded no-session behavior regresses.
- After dependency/gate integration: do not proceed if Trellis enters product
  dependency graphs or frozen install fails.
- Before Claude review: all targeted and full gates must already pass.

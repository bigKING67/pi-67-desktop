# Codex Initial Review: Trellis Multi-Agent Handoff

- Reviewer: Codex main session
- Date: 2026-08-22
- Scope: repository-local Trellis configuration for Codex, Claude Code, Pi Agent, and Grok Build
- Mode: read-only audit; only this task's planning/research artifacts were written
- Evidence labels: `CONFIRMED`, `LIKELY`, `UNVERIFIED`

## Executive Verdict

The repository has a real Trellis foundation, not an empty directory: all four platform adapters were generated, all four CLIs are installed, Codex project hooks are live and trusted, task fallback resolves this Codex-created task for Claude/Pi/Grok probe identities, and `trellis mem` discovers history from all four platforms.

It is not ready to be the default implementation workflow yet. Use it only as a pilot for read-only planning/review until the authority conflict, auto-commit default, empty specs/bootstrap state, invalid default package, and untracked configuration are resolved.

The intended collaboration model must distinguish two capabilities:

1. **Sequential four-platform handoff is available** through versioned task artifacts, explicit task paths, and local `trellis mem` history.
2. **Live Trellis channel workers are only Claude/Codex** in Trellis 0.6.15. Pi and Grok have project adapters and native/platform sub-agent surfaces, but the channel provider registry does not spawn them.

## Confirmed Capabilities

| Capability | Status | Evidence |
|---|---|---|
| Trellis CLI | `CONFIRMED` | `trellis --version` -> `0.6.15` |
| Platform generation | `CONFIRMED` | `trellis platforms` lists Claude Code, Codex, Pi Agent, and Grok Build |
| Installed CLIs | `CONFIRMED` | Codex `0.149.0`, Claude Code `2.1.238`, Pi `0.80.6`, Grok `1.0.5` |
| Generated-file integrity | `CONFIRMED` | 199 template hash entries; 195 match; four differences are ignored Python bytecode files only |
| Static syntax | `CONFIRMED` | 34 Python files parsed with `ast`; three JSON files and one TOML file parsed successfully |
| Codex project trust/hooks | `CONFIRMED` | project is trusted; hooks feature enabled; App Server probe reports 18/18 enabled and trusted, sources `project` + `user`, zero warnings/errors |
| Codex workflow injection | `CONFIRMED` | synthetic `UserPromptSubmit` resolves this task and emits `workflow-state: planning`; the current Codex session also receives the Trellis bootstrap/mode breadcrumb |
| Cross-platform task fallback | `CONFIRMED` | `TRELLIS_CONTEXT_ID=claude_audit_probe`, `pi_audit_probe`, and `grok_audit_probe` all resolve this task through `session-fallback` while only one session pointer exists |
| Claude installation | `CONFIRMED` | `claude doctor` reports native install and no installation issues |
| Grok project discovery | `CONFIRMED` | `grok inspect` discovers the project Trellis skills and `trellis-{research,implement,check}` agents |
| Cross-session history adapters | `CONFIRMED` | `trellis mem projects` finds 47 sessions for this repository: Claude 11, Codex 12, Grok 6, Pi 18 |
| Current task artifacts | `CONFIRMED` | `task.py validate` passes; this task has a converged PRD and intentionally empty manifests for independent planning-only review |

## Findings

### F-01 High - Repository authority still prohibits Trellis (`CONFIRMED`)

**Evidence**

- `AGENTS.md:79-86` says L2 uses `PLANS.md` and Trellis is not part of the current solo-developer workflow.
- `PLANS.md:106-111` says not to introduce Trellis for the current workflow.
- `CLAUDE.md` declares `AGENTS.md` the highest-priority project authority.
- Trellis hooks and skills now instruct Codex/Claude/Pi/Grok to create and continue Trellis tasks.

**Impact**

Every correctly configured agent receives contradictory project instructions. An agent may refuse Trellis, use it inconsistently, or create both a Trellis plan and a `PLANS.md` plan without a clear ownership boundary. This is the highest-priority adoption blocker.

**Minimum remediation direction**

Replace the blanket prohibition with a route contract:

- Direct: ordinary single-session L0/L1 work, no Trellis artifact.
- Trellis Lite: cross-session, multi-agent, independent review, or durable handoff; PRD/research only when sufficient.
- Trellis Full: L2 migration, release, security, rollback, or multi-module work; PRD + design + implement plan + curated manifests.
- `PLANS.md` remains the repository's general execution-plan format/authority map, not a second per-task plan when Trellis Full already owns the task plan.

### F-02 High - Session/task lifecycle auto-commits by default (`CONFIRMED`)

**Evidence**

- `.trellis/config.yaml:21-33` documents `true` as the default, but the override is commented out.
- `.trellis/scripts/common/config.py:167-245` sets `DEFAULT_SESSION_AUTO_COMMIT = True`; it controls both journal recording and task archive commits.
- Existing repository/global governance requires explicit, scoped commit authorization.

**Impact**

`add_session.py` or task archive flows may stage and commit Trellis bookkeeping without the user's current commit authorization. Even if the staged paths are scoped, the autonomous commit itself violates the established boundary and can surprise whichever AI tool finishes the task.

**Minimum remediation direction**

Set `session_auto_commit: false` explicitly and retain manual scoped staging/commit by the main session only.

### F-03 High - Project specs are effectively unbootstrapped; developer aliases are not normalized (`CONFIRMED`)

**Evidence**

- 82 Markdown files exist under `.trellis/spec/`; 79 contain generated placeholder language.
- Example: `.trellis/spec/agent-host/backend/quality-guidelines.md:7-51` is entirely `(To be filled by the team)` scaffolding.
- `.trellis/tasks/00-bootstrap-guidelines/task.json:1-33` remains `in_progress`, assigned to `bigKING67`, while the current Trellis developer string is `sixseven`.
- The user confirmed that `bigKING67` and `sixseven` are historical/current names for the same person. This is not evidence of a second owner.
- Trellis compares the assignee strings literally: `task.py list --mine` under `sixseven` hides the bootstrap task, while the all-task list still shows it.

**Impact**

Sub-agents can receive generic or empty engineering guidance and may diverge from `AGENTS.md`, `CONTRIBUTING.md`, architecture docs, and actual code patterns. The bootstrap task is not human-owner-orphaned, but its historical assignee alias makes it invisible to current-identity `--mine` filtering and leaves it as active-task noise.

**Minimum remediation direction**

Do not manually fill 79 files with duplicated prose. First define a small project-specific spec strategy that points to existing authorities and adds only package/layer rules that materially affect implementation. Choose one canonical Trellis developer identity for future task metadata, decide whether historical tasks should be reassigned or merely documented as aliases, complete the minimum valuable spec set with real file examples, then explicitly finish/archive the bootstrap task without auto-commit.

### F-04 Medium - Invalid `default_package` (`CONFIRMED`)

**Evidence**

- `.trellis/config.yaml:161-176` declares package key `agent-host` but sets `default_package: @pi67/agent-host`.
- Task creation emits: `Warning: default_package '@pi67/agent-host' not found in config, skipping`.
- `.trellis/scripts/common/config.py:510-546` validates the default against package keys and returns no package on mismatch.

**Impact**

Tasks without an explicit package lose the intended default spec/package scope. The current task was created with `package: null` after this warning.

**Minimum remediation direction**

Use `default_package: agent-host`, or intentionally remove the default and require explicit package selection. The first option matches the generated package map and current init intent.

### F-05 High - The whole Trellis integration is untracked (`CONFIRMED`)

**Evidence**

- `git ls-files .trellis .agents .claude .codex .grok .pi` returns no tracked paths.
- Current untracked-file counts: `.agents` 46, `.claude` 52, `.codex` 8, `.grok` 49, `.pi` 8, `.trellis` 126.
- `.gitattributes` is modified but uncommitted.
- Branch state is `main...origin/main [ahead 1]` before any Trellis commit.

**Impact**

Same-worktree sessions can see the files, but another clone, clean checkout, branch recovery, or teammate machine cannot. The task/review history is not currently bound to a Git revision and can be lost or silently diverge.

**Minimum remediation direction**

After configuration fixes and independent review, perform a scoped commit of only the approved Trellis/platform/authority paths. Do not use `git add -A`; do not push without separate authorization.

### F-06 Design limitation - Live channel workers exclude Pi and Grok (`CONFIRMED`)

**Evidence**

- `trellis channel spawn --help` accepts `--provider claude | codex` only.
- `.agents/skills/trellis-channel/references/command-reference.md:209-240` confirms the current adapter registry contains `claude` and `codex`.

**Impact**

One Trellis channel can coordinate live Claude/Codex workers, but cannot directly spawn Pi or Grok workers. This is a product limitation, not a repository misconfiguration.

**Recommended operating model**

- Use task artifacts for the four-platform sequential chain.
- Use live channels only for Claude/Codex peer discussion or review.
- Let Pi use `.pi/extensions/trellis/` and `trellis_subagent` inside its own host.
- Let Grok use its project agents/skills and explicit task path inside its own session.
- Do not describe these separate mechanisms as one four-provider channel.

### F-07 Medium - Implicit cross-session task adoption is intentionally fragile (`CONFIRMED`)

**Evidence**

- `.trellis/scripts/common/active_task.py:600-655` falls back only when exactly one runtime session pointer exists; zero or two-plus pointers return no task rather than guessing.
- Current probes succeed only via `session-fallback:codex_<session>`.
- `.trellis/.gitignore:1-8` correctly keeps developer identity and runtime session pointers local/ignored.

**Impact**

The next Claude session can currently discover this task, but the behavior is not a durable multi-window routing contract. With multiple open agent windows, the implicit fallback disappears. The ignored runtime pointer also does not move with Git.

**Minimum remediation direction**

Every cross-tool handoff should name the exact task path. During planning, the next reviewer should read/write that path directly and must not run `task.py start` merely to attach, because `start` changes `planning` to `in_progress`. After the final planning review is approved, each execution session may explicitly bind the already-started task using the documented lifecycle.

### F-08 Medium - Grok discovers the integration but the repository is not trusted (`CONFIRMED` status, `UNVERIFIED` impact)

**Evidence**

- `grok inspect` reports `Project trusted: no`.
- The same output still discovers project Trellis skills and three Trellis agents.
- The local Grok trust store has entries for other repositories, not this one.

**Impact**

Static discovery works. Whether the exact planned Grok session will prompt, skip any project executable surface, or run fully is not verified here. Grok's Trellis adapter is pull-based and this project has no Grok project hook/config file, so lack of trust is not automatically equivalent to total Trellis failure.

**Minimum remediation direction**

After reviewing and committing the repository-local configuration, explicitly trust this folder in the Grok session if the operator wants project executable surfaces enabled. Record the resulting live `grok inspect`/session behavior; do not grant trust merely to make an audit green.

### F-09 Low - `.gitattributes` documentation points to a nonexistent spec (`CONFIRMED`)

**Evidence**

- `.gitattributes:8-11` refers to `.trellis/spec/cli/backend/directory-structure.md`.
- That path does not exist in this repository's package map.

**Impact**

The `merge=union` rule itself is syntactically valid, but future conflict resolution guidance points to a dead path.

**Minimum remediation direction**

Replace the stale pointer with an existing authority or remove the reference while preserving the intended merge rule if it remains desired.

### F-10 Coverage gap - Claude/Pi/Grok host execution is not yet proven (`UNVERIFIED`)

**Evidence collected**

- Claude CLI/doctor and project settings exist; a direct hook-script probe resolves the planning task.
- Pi CLI and `.pi/settings.json`/extension exist; TypeScript extension was inspected but no live Pi session/tool inventory was started.
- Grok CLI/inspect discovers project skills/agents; no model session was started.

**Not proven**

- Claude SessionStart and PreToolUse hooks firing in a real Claude session.
- Pi loading `.pi/extensions/trellis/index.ts` and exposing/calling `trellis_subagent` in a real Pi session.
- Grok starting a Trellis project agent and persisting a review artifact.
- Any paid model's review quality.

The user's planned Claude independent review is the next high-value live proof. Pi and Grok should be verified later with bounded read-only tasks, not inferred from file presence.

## Non-Blocking Notes

- Native Trellis workflow is installed; `channel-driven-subagent-dispatch` is available but not selected.
- Codex `codex.dispatch_mode` is omitted, so Trellis defaults to `auto`; project Codex `agents.max_depth = 1` bounds recursion.
- Channel worker guard is `idle_timeout: 5m`, `max_live_workers: 6`; no issue was demonstrated in this audit.
- The full Codex post-upgrade verifier stopped because `doctor.overallStatus` was `warning` for an optional desktop CDN reachability check. The targeted App Server runtime probe passed; the CDN warning is not treated as a Trellis defect.
- `task.py validate` reports zero real `implement.jsonl`/`check.jsonl` entries. That is intentional while the Claude pass must remain independent and this task remains planning/research-only; it would be insufficient for sub-agent implementation/check of a complex task.

## Recommended Remediation Order

1. Independent Claude review of this same task; preserve disagreements.
2. Decide and document Direct / Trellis Lite / Trellis Full routing in `AGENTS.md` and `PLANS.md`.
3. Set `session_auto_commit: false` and fix `default_package`.
4. Define the minimum real spec set, normalize or document the `bigKING67`/`sixseven` alias, and close bootstrap only after validation.
5. Fix the stale `.gitattributes` reference.
6. Run bounded live smoke in Claude, then Pi, then Grok; record exact artifacts and limitations.
7. Review scoped diff and commit only approved Trellis/platform/authority files; do not push without authorization.

## Claude Independent Review Protocol

Claude should be instructed with the exact path:

```text
Review the Trellis configuration in this repository independently.
Active planning task: .trellis/tasks/08-22-review-trellis-multi-agent-flow

First read prd.md and inspect the live repository/configuration yourself.
Write your independent findings to:
.trellis/tasks/08-22-review-trellis-multi-agent-flow/research/claude-review.md

Do not edit product code, Trellis behavior, Codex's codex-review.md, Git state,
or global configuration. Do not run task.py start. After your independent pass,
compare codex-review.md and record agreements, disagreements, and missing proof
inside claude-review.md.
```

Claude acceptance:

- Writes only `research/claude-review.md`.
- Re-runs decisive local checks rather than copying this report.
- Separates configuration presence, synthetic hook execution, and actual host runtime evidence.
- Explicitly assesses the authority conflict, auto-commit, specs/bootstrap, package key, Git durability, channel provider boundary, task-pointer fallback, and Grok trust.
- Does not declare Pi/Grok live integration verified without a real host session.

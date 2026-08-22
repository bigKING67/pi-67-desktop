# Trellis Development Workflow

## Authority

- Live Git/worktree and reproducible runtime evidence are authoritative.
- Task artifacts own requirements, design, implementation plan, research and the latest Handoff.
- Durable Relay Channel events are supplemental chronology, not task or authorization truth.
- `trellis mem` recovers missing historical context; it is not live state.
- Trellis never replaces Pi JSONL, the Pi agent loop, Provider routing, product protocol, Git, or release evidence.

## Routing

- L0: direct, no Task or Channel.
- L1: native implementation/check by default; Relay-capable Task/Handoff.
- L2: native implementation plus one cross-provider Channel check by default.
- Channel implementation requires an explicit current user request.
- Switching Codex, Claude Code, Pi, or Grok is sequential; only one platform main session owns edits.

Planning tasks may omit routing metadata. `task.py start` requires valid `risk_level`, `execution_mode`, `review_mode`, and `handoff_mode` before it mutates an active pointer, status, or lifecycle hook. Missing or invalid values fail closed in `planning` with a visible remediation message; they never select Native or Channel execution implicitly.

## Channel contracts

- Durable `relay-*` Channel: no Worker, bounded metadata only, one per Task.
- Ephemeral `impl-*` / `check-*` Channel: exactly one Claude/Codex Worker, bounded timeout, raw evidence, explicit termination.
- Do not parse Pretty progress as completion. Wait for `done,error,killed` and inspect `messages --raw`.
- `channel send` has no supported custom `--tag`; structured Relay data lives in a validated ordinary message body.
- Codex Channel Workers must use `--sandbox danger-full-access`. Never silently switch Provider.

## Dirty worktree and review

- Snapshot dirty paths before a Worker starts.
- The main session must stop editing the Worker's declared scope.
- Worker briefs name editable paths, forbidden paths, validation commands and forbidden external/Git actions.
- After the Worker terminates, the main session re-reads the complete diff and re-runs decisive checks.
- Mechanical fixes may be self-applied; design/contract changes remain findings until the main session decides.

## Handoff and privacy

- `handoff.md` is the latest bounded snapshot, not an append-only transcript.
- Channel messages must not contain source bodies, prompts, raw diffs/logs/tool payloads, credentials, cookies, tokens, or private keys.
- A Channel Actor name is advisory and never grants authorization.
- Relay operations never commit, push, deploy, publish, delete history, or silently change Model/Provider.

## Verification

- Test zero/one/multiple Task resolution, status-neutral attach, Hash drift, malformed events, Channel loss and explicit Takeover.
- Verify Same-CLI Channel review and cross-CLI Sequential Relay separately.
- Static/generated configuration is not live Host evidence; record exact CLI/runtime receipts and remaining gaps.

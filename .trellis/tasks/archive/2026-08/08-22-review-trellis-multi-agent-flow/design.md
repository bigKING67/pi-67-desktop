# Design: Native-first + Channel Review + Sequential Relay

## Architecture

### Sources of truth

1. Live Git/worktree and reproducible runtime evidence.
2. Task artifacts: `prd.md`, `design.md`, `implement.md`, `research/`.
3. Latest bounded `handoff.md` snapshot.
4. Durable Relay Channel metadata events.
5. Targeted `trellis mem` recovery.

Trellis remains developer coordination only. Pi JSONL remains product conversation truth.

### Execution modes

Task metadata stores four explicit strings:

- `risk_level`: `L1 | L2 | high`
- `execution_mode`: `inline | native | channel`
- `review_mode`: `native | channel`
- `handoff_mode`: `none | relay`

Defaults are L1=`native/native/relay`, L2=`native/channel/relay`. Only an explicit user request sets `execution_mode=channel`.

### Channel types

Durable Relay Channel name: `relay-<createdAt>-<task.id>`. It is project-scoped, non-ephemeral, has no Worker, and stores bounded structured messages.

Ephemeral Worker Channels are `impl-<task.id>-r<N>` or `check-<task.id>-r<N>`. They have one Worker, explicit Provider, bounded timeout, raw evidence, and terminate after a final event.

## Relay CLI

Add `.trellis/scripts/trellis_relay.py` with subcommands:

- `ensure <task>`
- `resume [<task>] --platform <codex|claude|pi|grok> --mode <continue|review> [--json]`
- `checkpoint <task> --platform <...> [--json]`
- `release <task> --platform <...> [--json]`
- `close <task> --platform <...> [--json]`
- `status [<task>] [--json]`

The CLI calls `trellis channel` rather than editing `events.jsonl`. It may use existing `.trellis/scripts/common/active_task.py` for a status-neutral Session pointer when identity exists.

### Event body

Every Relay message is JSON with schema `pi67.trellis-relay.event.v1`, a UUID `eventId`, action, Task path, Actor, mode, UTC timestamp, Task status, Git HEAD, Dirty Digest, Handoff path/hash, and bounded next step. Messages over 4 KiB or containing disallowed secret/raw-payload markers fail validation.

`trellis channel send` has no custom `--tag`; readers use `messages --kind message --raw` and then validate the JSON body. Malformed messages are ignored with a warning.

### Handoff

`<task>/handoff.md` stores only the latest snapshot: goal/status, decisions, Git/dirty scope, changed scope, validation, risks, next action, actor/time/hash. It is capped at 16 KiB; detailed evidence belongs in `research/`.

## Worker review

- Codex main defaults to Claude check Worker.
- Claude main defaults to Codex check Worker with `--sandbox danger-full-access`.
- Pi/Grok main default to Claude check Worker because Channel Spawn does not support Pi/Grok.
- No silent Provider fallback.
- Wait for `done,error,killed`; inspect `messages --raw`; then kill/confirm process exit.
- Small mechanical fixes are allowed. Design changes are report-only.
- Main session owns final judgment, spec update, commit and finish.

## Compatibility and failure handling

- Trellis compatibility baseline is 0.6.15; unsupported CLI shape fails the static gate.
- Missing Relay Channel is recreated from Task state.
- Multiple active candidates or Task/Channel mismatch fail closed.
- Stale Claim may be taken over only from an explicit user Continue/Takeover request.
- Channel failure never destroys Task state; recovery falls back to Artifact/Git/mem.
- Cross-machine recovery only includes committed Task artifacts, not local Channel history.

## Security and privacy

- Channel store contains metadata only; actor names are advisory.
- `.claude/settings.local.json` is local-only and uses `bypassPermissions`.
- Codex Channel Workers use approval `never` plus explicit full-access sandbox.
- No automatic chmod of the user-wide Channel store; insecure permissions produce a warning.
- No source, prompt, raw diff, raw logs, secrets, commit, push, deploy or publish in Relay operations.

## Rollback

The feature is isolated to developer tooling. Rollback disables lifecycle hooks and platform Relay entrypoints, leaving Task artifacts intact. Existing Channel logs remain outside Git and are not deleted automatically.

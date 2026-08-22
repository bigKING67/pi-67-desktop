---
name: trellis-continue
description: "Resume or take over the active Pi-67 Trellis task. Use when the user says 继续, 接着做, 接手, 换个思路, 接手并复核, or asks to recover work after another AI CLI/quota failure."
---

# Continue or Take Over a Pi-67 Task

Resume from durable Task/Relay state rather than relying on the current chat transcript.

## 1. Resolve intent and task

Map the user wording to one mode:

- `继续`, `接着做`, `接手` -> `continue`
- `换个思路`, `接手并复核`, `独立审一次` -> `review`

Run:

```bash
python3 ./.trellis/scripts/trellis_relay.py resume --platform codex --mode <continue|review>
```

If the command reports multiple candidate tasks or a Task/Channel mismatch, stop and show the candidates. Never guess. A missing/unavailable Channel may degrade to the exact Task artifact path, but it must stay visible.

## 2. Re-establish live truth

Always verify cwd, branch, HEAD, dirty paths, Task status, and the current Handoff hash. Live Git/worktree evidence outranks Relay messages.

- In `continue` mode, read the latest `handoff.md`, Task artifacts, and accepted Relay checkpoint, then continue from the next workflow step.
- In `review` mode, inspect the live diff/tests first and form an independent initial judgment before reading earlier review conclusions. Write a separate file under the Task's `research/` directory.

If the previous actor did not release, only the user's explicit takeover wording
authorizes adding `--takeover` to `trellis_relay.py resume`, which records a
Relay `takeover` event. It does not authorize commit, push, deploy, release, or
provider/model fallback.

## 3. Load workflow phase

```bash
python3 ./.trellis/scripts/get_context.py --mode phase
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.X> --platform codex
```

Follow `task.json.meta`:

- implementation defaults to the current CLI or its native sub-agent;
- L2 review defaults to one cross-provider Channel check worker;
- Channel implementation is explicit-only;
- ordinary Relay never spawns a worker.

## 4. Checkpoint before yielding

Update the bounded latest-state `handoff.md`, then run:

```bash
python3 ./.trellis/scripts/trellis_relay.py checkpoint <task-path> --platform codex
```

Use `release` when deliberately handing the task to another CLI. Do not dump raw logs, source, prompts, diffs, tool payloads, or credentials into the Channel.

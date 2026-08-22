# Continue or Take Over a Pi-67 Task

Interpret `继续` / `接着做` / `接手` as `continue`, and `换个思路` / `接手并复核` / `独立审一次` as `review`.

```bash
python3 ./.trellis/scripts/trellis_relay.py resume --platform pi --mode <continue|review>
```

If multiple Tasks or a Task/Channel mismatch are reported, stop and show the candidates; never guess. Re-check cwd, branch, HEAD, dirty paths, Task status, and Handoff hash. Git/worktree evidence wins over Relay metadata.

In `continue` mode, read the latest Handoff and Task artifacts. In `review` mode, inspect the live diff/tests and form an independent initial judgment before reading prior reviews; write a separate research artifact.

Add `--takeover` to the resume command only when the user explicitly asks to
take over an unreleased task. That event is advisory and grants no additional
Git, external-action, or Provider authority.

Then load the workflow phase:

```bash
python3 ./.trellis/scripts/get_context.py --mode phase
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.X> --platform pi
```

Implementation is native-first; L2 defaults to one Claude/Codex Channel check because Pi is not a Channel Spawn Provider; Channel implementation is explicit-only. Before yielding, update bounded `handoff.md` and run `trellis_relay.py checkpoint <task> --platform pi`; use `release` for deliberate handoff. Relay never authorizes commit, push, deploy, publish, model fallback, or raw sensitive payload persistence.

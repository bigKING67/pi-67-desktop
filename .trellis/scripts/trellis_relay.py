#!/usr/bin/env python3
"""Bounded Relay metadata for cross-platform Trellis task handoffs.

The Relay is deliberately a thin wrapper around ``trellis channel``.  It never
writes Channel storage directly and it does not replace task artifacts or Git
as sources of truth.  Relay messages contain only compact metadata so a future
session can locate and verify the real task state without copying prompts,
source, diffs, logs, tool payloads, or credentials into the Channel.

Lifecycle hooks invoke this file with ``TASK_JSON_PATH`` set by Trellis, for
example::

    TASK_JSON_PATH=/repo/.trellis/tasks/08-22-example/task.json \
      python3 .trellis/scripts/trellis_relay.py ensure "$TASK_JSON_PATH" --json
    TASK_JSON_PATH=/repo/.trellis/tasks/08-22-example/task.json \
      python3 .trellis/scripts/trellis_relay.py close --actor lifecycle --json

``resume`` and ``checkpoint`` remain user-facing operations and require a
known platform.  Hook actions use the stable ``lifecycle`` actor instead.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from common.active_task import resolve_active_task, resolve_context_key, resolve_task_ref, set_active_task
from common.paths import get_repo_root


EVENT_SCHEMA = "pi67.trellis-relay.event.v1"
MAX_EVENT_BYTES = 4096
MAX_HANDOFF_BYTES = 16 * 1024
MAX_NEXT_STEP_CHARS = 512
PLATFORMS = frozenset({"codex", "claude", "pi", "grok"})
SYSTEM_ACTORS = frozenset({"system", "lifecycle"})
EVENT_ACTIONS = frozenset({"ensure", "resume", "takeover", "checkpoint", "release", "close"})
HANDOFF_HEADINGS = (
    "Goal/Status",
    "Decisions",
    "Git/Dirty Scope",
    "Changed Scope",
    "Validation",
    "Risks",
    "Next Action",
    "Actor/Time/Hash",
)
DISALLOWED_RE = re.compile(
    r"(?:\bprompt\b|raw[ _-]?(?:diff|log)|tool[ _-]?payload|"
    r"\b(?:api[ _-]?key|secret|password|cookie|private[ _-]?key)\b|"
    r"\bauthorization\s*:|\bbearer\s+)",
    re.IGNORECASE,
)
CHANNEL_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class RelayError(RuntimeError):
    """A recoverable Relay contract violation."""


@dataclass(frozen=True)
class TaskState:
    directory: Path
    relative_path: str
    data: dict[str, Any]

    @property
    def task_id(self) -> str:
        value = self.data.get("id") or self.data.get("name") or self.directory.name
        return str(value)

    @property
    def status(self) -> str:
        value = self.data.get("status", "unknown")
        return str(value)


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _canonical_relative(path: Path, repo_root: Path) -> str:
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except (OSError, ValueError) as exc:
        raise RelayError(f"Task path is outside the repository: {path}") from exc


def _task_from_path(task_ref: str | None, repo_root: Path, *, allow_active: bool) -> TaskState:
    candidate_ref = task_ref
    if not candidate_ref and allow_active:
        active = resolve_active_task(repo_root, allow_single_session_fallback=True)
        candidate_ref = active.task_path
        if active.stale:
            raise RelayError("The active task pointer is stale; provide an exact task path")
    if not candidate_ref:
        raise RelayError("No task resolved; provide an exact task path")

    raw = Path(candidate_ref)
    if raw.name == "task.json":
        candidate = raw.parent if raw.is_absolute() else repo_root / raw.parent
    else:
        candidate = resolve_task_ref(candidate_ref, repo_root)
    if candidate is None:
        raise RelayError(f"Unsafe task path: {candidate_ref}")
    try:
        candidate = candidate.resolve()
    except OSError as exc:
        raise RelayError(f"Unable to resolve task path: {candidate_ref}") from exc

    tasks_root = (repo_root / ".trellis" / "tasks").resolve()
    try:
        candidate.relative_to(tasks_root)
    except ValueError as exc:
        raise RelayError(f"Task must be inside .trellis/tasks: {candidate_ref}") from exc

    task_json = candidate / "task.json"
    try:
        data = json.loads(task_json.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RelayError(f"Task metadata not found: {task_json}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise RelayError(f"Invalid task metadata: {task_json}") from exc
    if not isinstance(data, dict):
        raise RelayError(f"Task metadata must be an object: {task_json}")
    if not isinstance(data.get("status"), str):
        raise RelayError(f"Task status is missing or invalid: {task_json}")
    return TaskState(candidate, _canonical_relative(candidate, repo_root), data)


def _task_from_argument_or_hook(task_ref: str | None, repo_root: Path, *, allow_active: bool) -> TaskState:
    if task_ref:
        return _task_from_path(task_ref, repo_root, allow_active=False)
    hook_path = os.environ.get("TASK_JSON_PATH")
    if hook_path:
        return _task_from_path(hook_path, repo_root, allow_active=False)
    return _task_from_path(None, repo_root, allow_active=allow_active)


def _handoff_state(task: TaskState, repo_root: Path) -> dict[str, Any]:
    handoff = task.directory / "handoff.md"
    relative = _canonical_relative(handoff, repo_root)
    if not handoff.exists():
        return {"path": relative, "sha256": None, "present": False}
    if not handoff.is_file():
        raise RelayError(f"Handoff is not a regular file: {relative}")
    try:
        body = handoff.read_bytes()
    except OSError as exc:
        raise RelayError(f"Unable to read handoff: {relative}") from exc
    if len(body) > MAX_HANDOFF_BYTES:
        raise RelayError(f"Handoff exceeds {MAX_HANDOFF_BYTES} bytes: {relative}")
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RelayError(f"Handoff is not UTF-8: {relative}") from exc
    if DISALLOWED_RE.search(text):
        raise RelayError("Handoff contains prohibited secret or raw-payload marker")
    if text.strip():
        headings = {line[2:].strip() for line in text.splitlines() if line.startswith("## ")}
        missing = [heading for heading in HANDOFF_HEADINGS if heading not in headings]
        if missing:
            raise RelayError(f"Handoff is missing required headings: {', '.join(missing)}")
    return {"path": relative, "sha256": _sha256_bytes(body), "present": True}


def _git_state(repo_root: Path) -> tuple[str | None, str]:
    def git(*args: str) -> tuple[int, str]:
        result = subprocess.run(
            ["git", *args], cwd=repo_root, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        return result.returncode, result.stdout

    head_rc, head_out = git("rev-parse", "HEAD")
    status_rc, status_out = git("status", "--porcelain=v1", "--untracked-files=all")
    if status_rc != 0:
        status_out = "git-status-unavailable"
    return (head_out.strip() if head_rc == 0 else None, _sha256_bytes(status_out.encode("utf-8")))


def _channel_name(task: TaskState) -> str:
    created = str(task.data.get("createdAt") or "undated")
    created = re.sub(r"[^A-Za-z0-9]+", "-", created).strip("-") or "undated"
    task_id = re.sub(r"[^A-Za-z0-9._-]+", "-", task.task_id).strip(".-") or task.directory.name
    name = f"relay-{created}-{task_id}"[:128].rstrip(".-")
    if not CHANNEL_NAME_RE.fullmatch(name):
        raise RelayError(f"Generated invalid relay channel name: {name!r}")
    return name


def _run_channel(repo_root: Path, args: list[str]) -> subprocess.CompletedProcess[str]:
    environment = dict(os.environ)
    # A spawned Channel worker inherits its supervisor's project bucket. Relay
    # operations are always bound to the repository passed here, so retaining
    # that parent override would make `list` inspect one bucket while
    # `create --cwd` writes another. Keep TRELLIS_CHANNEL_ROOT for isolated
    # tests, but derive the project key from this canonical cwd on every call.
    environment.pop("TRELLIS_CHANNEL_PROJECT", None)
    try:
        return subprocess.run(
            ["trellis", "channel", *args],
            cwd=repo_root,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as exc:
        raise RelayError(f"Relay Channel unavailable: {exc}") from exc


def _list_channels(repo_root: Path) -> list[dict[str, Any]]:
    result = _run_channel(repo_root, ["list", "--json", "--all"])
    if result.returncode != 0:
        raise RelayError(f"Relay Channel unavailable: {result.stderr.strip() or result.stdout.strip() or 'channel list failed'}")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RelayError("Relay Channel returned malformed list JSON") from exc
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise RelayError("Relay Channel returned an invalid list shape")
    return value


def _channel_task_matches(channel: dict[str, Any], task: TaskState, repo_root: Path) -> bool:
    raw = channel.get("task")
    if not isinstance(raw, str) or not raw.strip():
        return False

    # Archive moves the task after the Channel was created, while the Channel's
    # immutable task reference still points at the former active location.
    # Accept only that exact same-dir alias; never match an arbitrary missing
    # path by id or basename alone.
    raw_path = Path(raw)
    try:
        raw_relative = (
            raw_path.resolve().relative_to(repo_root.resolve()).as_posix()
            if raw_path.is_absolute()
            else (repo_root / raw_path).resolve().relative_to(repo_root.resolve()).as_posix()
        )
    except (OSError, ValueError):
        raw_relative = ""
    aliases = {task.relative_path}
    task_parts = Path(task.relative_path).parts
    if len(task_parts) >= 5 and task_parts[:3] == (".trellis", "tasks", "archive"):
        aliases.add(f".trellis/tasks/{task.directory.name}")
    if raw_relative in aliases:
        return True

    try:
        other = _task_from_path(raw, repo_root, allow_active=False)
    except RelayError:
        return False
    return other.directory == task.directory


def _resolve_channel(task: TaskState, repo_root: Path, *, create: bool) -> tuple[str | None, str]:
    expected = _channel_name(task)
    channels = _list_channels(repo_root)
    matching = [
        item
        for item in channels
        if isinstance(item.get("name"), str)
        and item["name"].startswith("relay-")
        and _channel_task_matches(item, task, repo_root)
    ]
    named = [item for item in channels if item.get("name") == expected]
    if any(not _channel_task_matches(item, task, repo_root) for item in named):
        raise RelayError(f"Relay channel name collision or task mismatch: {expected}")
    if len(matching) > 1:
        raise RelayError(f"Multiple Relay channels match task {task.relative_path}; refusing to guess")
    if matching:
        name = matching[0].get("name")
        if not isinstance(name, str) or not CHANNEL_NAME_RE.fullmatch(name):
            raise RelayError("Relay Channel returned an invalid channel name")
        return name, "existing"
    if not create:
        return None, "missing"

    result = _run_channel(
        repo_root,
        [
            "create", expected, "--task", task.relative_path, "--description", "Pi-67 bounded task handoff metadata.",
            "--cwd", str(repo_root), "--by", "lifecycle",
        ],
    )
    if result.returncode != 0:
        # A concurrent ensure may have created the deterministic name. Re-list
        # and still fail closed if it maps to another task or duplicates exist.
        channels = _list_channels(repo_root)
        matching = [
            item
            for item in channels
            if isinstance(item.get("name"), str)
            and item["name"].startswith("relay-")
            and _channel_task_matches(item, task, repo_root)
        ]
        if len(matching) == 1 and matching[0].get("name") == expected:
            return expected, "existing"
        raise RelayError(f"Unable to create Relay channel: {result.stderr.strip() or result.stdout.strip()}")
    return expected, "created"


def validate_event(event: Any) -> dict[str, Any]:
    """Validate a Relay message body before sending or reducing it."""
    if not isinstance(event, dict):
        raise RelayError("Relay event must be a JSON object")
    required = {
        "schema", "eventId", "action", "taskPath", "actor", "mode", "timestamp",
        "taskStatus", "gitHead", "dirtyDigest", "handoffPath", "handoffSha256", "nextStep",
    }
    missing = sorted(required.difference(event))
    if missing:
        raise RelayError(f"Relay event is missing fields: {', '.join(missing)}")
    if set(event).difference(required):
        raise RelayError("Relay event contains unsupported fields")
    if event["schema"] != EVENT_SCHEMA:
        raise RelayError("Unsupported Relay event schema")
    try:
        uuid.UUID(str(event["eventId"]))
    except (ValueError, AttributeError) as exc:
        raise RelayError("Relay eventId must be a UUID") from exc
    if event["action"] not in EVENT_ACTIONS:
        raise RelayError("Relay event action is invalid")
    if not isinstance(event["taskPath"], str) or not event["taskPath"].startswith(".trellis/tasks/"):
        raise RelayError("Relay event taskPath must be a repository task path")
    if event["actor"] not in PLATFORMS.union(SYSTEM_ACTORS):
        raise RelayError("Relay event actor is invalid")
    if event["mode"] not in {"continue", "review", "lifecycle"}:
        raise RelayError("Relay event mode is invalid")
    if event["actor"] in SYSTEM_ACTORS and event["mode"] != "lifecycle":
        raise RelayError("System Relay actors must use lifecycle mode")
    if event["actor"] in PLATFORMS and event["mode"] == "lifecycle":
        raise RelayError("Platform Relay actors cannot use lifecycle mode")
    if not isinstance(event["taskStatus"], str) or not event["taskStatus"].strip():
        raise RelayError("Relay event taskStatus is invalid")
    if event["gitHead"] is not None and (not isinstance(event["gitHead"], str) or not re.fullmatch(r"[0-9a-f]{40}", event["gitHead"])):
        raise RelayError("Relay event gitHead must be a SHA-1 or null")
    if not isinstance(event["dirtyDigest"], str) or not re.fullmatch(r"[0-9a-f]{64}", event["dirtyDigest"]):
        raise RelayError("Relay event dirtyDigest must be a SHA-256")
    if not isinstance(event["handoffPath"], str) or not event["handoffPath"].startswith(".trellis/tasks/"):
        raise RelayError("Relay event handoffPath is invalid")
    if event["handoffSha256"] is not None and (not isinstance(event["handoffSha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", event["handoffSha256"])):
        raise RelayError("Relay event handoffSha256 must be a SHA-256 or null")
    if not isinstance(event["nextStep"], str) or not event["nextStep"].strip() or len(event["nextStep"]) > MAX_NEXT_STEP_CHARS:
        raise RelayError("Relay event nextStep is invalid or too long")
    if not isinstance(event["timestamp"], str) or not event["timestamp"].endswith("Z"):
        raise RelayError("Relay event timestamp must be UTC ISO-8601")
    try:
        datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00"))
    except ValueError as exc:
        raise RelayError("Relay event timestamp is invalid") from exc
    encoded = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_EVENT_BYTES:
        raise RelayError(f"Relay event exceeds {MAX_EVENT_BYTES} bytes")
    if DISALLOWED_RE.search(json.dumps(event, ensure_ascii=False)):
        raise RelayError("Relay event contains prohibited secret or raw-payload marker")
    return event


def _make_event(task: TaskState, repo_root: Path, action: str, actor: str, mode: str) -> dict[str, Any]:
    handoff = _handoff_state(task, repo_root)
    head, dirty = _git_state(repo_root)
    event = {
        "schema": EVENT_SCHEMA,
        "eventId": str(uuid.uuid4()),
        "action": action,
        "taskPath": task.relative_path,
        "actor": actor,
        "mode": mode,
        "timestamp": _utc_now(),
        "taskStatus": task.status,
        "gitHead": head,
        "dirtyDigest": dirty,
        "handoffPath": handoff["path"],
        "handoffSha256": handoff["sha256"],
        "nextStep": f"Read task artifacts and continue in {mode} mode.",
    }
    return validate_event(event)


def _send_event(channel: str, event: dict[str, Any], repo_root: Path) -> None:
    body = json.dumps(validate_event(event), ensure_ascii=False, separators=(",", ":"))
    result = _run_channel(repo_root, ["send", channel, body, "--as", event["actor"]])
    if result.returncode != 0:
        raise RelayError(f"Unable to append Relay event: {result.stderr.strip() or result.stdout.strip()}")


def _read_events(channel: str, repo_root: Path) -> tuple[list[dict[str, Any]], list[str]]:
    result = _run_channel(repo_root, ["messages", channel, "--kind", "message", "--raw"])
    if result.returncode != 0:
        raise RelayError(f"Unable to read Relay messages: {result.stderr.strip() or result.stdout.strip()}")
    events: list[dict[str, Any]] = []
    warnings: list[str] = []
    for line in result.stdout.splitlines():
        try:
            channel_event = json.loads(line)
        except json.JSONDecodeError:
            warnings.append("Ignored malformed Channel event")
            continue
        if not isinstance(channel_event, dict):
            warnings.append("Ignored non-object Channel event")
            continue
        body = channel_event.get("text")
        if not isinstance(body, str):
            body = channel_event.get("message")
        if not isinstance(body, str):
            warnings.append("Ignored Channel message without text")
            continue
        try:
            events.append(validate_event(json.loads(body)))
        except (json.JSONDecodeError, RelayError):
            warnings.append("Ignored malformed Relay message")
    return events, warnings


def _reduce_events(events: Iterable[dict[str, Any]], task: TaskState, repo_root: Path) -> dict[str, Any]:
    valid = [event for event in events if event.get("taskPath") == task.relative_path]
    latest = valid[-1] if valid else None
    current_handoff = _handoff_state(task, repo_root)
    drift = bool(
        latest
        and latest.get("handoffSha256") is not None
        and latest.get("handoffSha256") != current_handoff["sha256"]
    )
    return {
        "eventCount": len(valid),
        "latestAction": latest.get("action") if latest else None,
        "latestActor": latest.get("actor") if latest else None,
        "latestTimestamp": latest.get("timestamp") if latest else None,
        "handoffDrift": drift,
    }


def _attach_without_status_change(task: TaskState, repo_root: Path, platform: str) -> dict[str, Any]:
    context_key = resolve_context_key(platform=platform)
    if not context_key:
        return {"attached": False, "attachSource": "no-session-identity"}
    previous = task.data.get("status")
    active = set_active_task(task.relative_path, repo_root, platform=platform)
    if active is None:
        raise RelayError("Unable to attach the task to the current session")
    after = json.loads((task.directory / "task.json").read_text(encoding="utf-8")).get("status")
    if after != previous:
        raise RelayError("Status-neutral attach unexpectedly changed task status")
    return {"attached": True, "attachSource": active.source, "contextKey": context_key}


def _output(payload: dict[str, Any], json_output: bool) -> None:
    if json_output:
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    else:
        print(f"task: {payload.get('taskPath')}")
        print(f"channel: {payload.get('channel') or payload.get('channelState')}")
        if payload.get("action"):
            print(f"action: {payload['action']}")
        for warning in payload.get("warnings", []):
            print(f"warning: {warning}", file=sys.stderr)


def _channel_unavailable(error: RelayError) -> bool:
    return str(error).startswith("Relay Channel unavailable:")


def _run_action(args: argparse.Namespace, repo_root: Path) -> dict[str, Any]:
    command = args.command
    explicit_task = getattr(args, "task", None)
    task = _task_from_argument_or_hook(explicit_task, repo_root, allow_active=command in {"resume", "status"})

    if command == "status":
        try:
            channel, state = _resolve_channel(task, repo_root, create=False)
        except RelayError as exc:
            if not _channel_unavailable(exc):
                raise
            return {
                "ok": True,
                "taskPath": task.relative_path,
                "channel": None,
                "channelState": "unavailable",
                "relayWritten": False,
                "fallback": "Relay Channel is unavailable; inspect task artifacts, Git, and targeted trellis mem.",
                "warnings": [str(exc)],
            }
        payload: dict[str, Any] = {"ok": True, "taskPath": task.relative_path, "channel": channel, "channelState": state}
        if channel is None:
            payload["fallback"] = "Task artifacts and Git remain available; Relay Channel has no matching metadata."
            payload["handoff"] = _handoff_state(task, repo_root)
            return payload
        events, warnings = _read_events(channel, repo_root)
        payload.update(_reduce_events(events, task, repo_root))
        payload["warnings"] = warnings
        return payload

    if command == "ensure":
        channel, state = _resolve_channel(task, repo_root, create=True)
        assert channel is not None
        event = _make_event(task, repo_root, "ensure", getattr(args, "actor", "lifecycle"), "lifecycle")
        _send_event(channel, event, repo_root)
        return {"ok": True, "taskPath": task.relative_path, "channel": channel, "channelState": state, "action": "ensure"}

    if command == "resume":
        actor = args.platform
        attach = _attach_without_status_change(task, repo_root, actor)
        try:
            channel, state = _resolve_channel(task, repo_root, create=True)
        except RelayError as exc:
            if not _channel_unavailable(exc):
                raise
            return {
                "ok": True,
                "taskPath": task.relative_path,
                "channel": None,
                "channelState": "unavailable",
                "relayWritten": False,
                "action": "resume",
                **attach,
                "fallback": "Relay Channel unavailable; continue from task artifacts, Git, and targeted trellis mem.",
                "warnings": [str(exc)],
            }
        payload = {"ok": True, "taskPath": task.relative_path, "channel": channel, "channelState": state, "action": "resume", **attach}
        assert channel is not None
        action = "takeover" if args.takeover else "resume"
        event = _make_event(task, repo_root, action, actor, args.mode)
        _send_event(channel, event, repo_root)
        payload["action"] = action
        return payload

    if command in {"checkpoint", "release", "close"}:
        platform_actor = args.platform if command == "checkpoint" else getattr(args, "platform", None)
        actor = platform_actor or getattr(args, "actor", "lifecycle")
        mode = (
            getattr(args, "mode", "continue")
            if command == "checkpoint"
            else ("continue" if platform_actor else "lifecycle")
        )
        try:
            channel, state = _resolve_channel(task, repo_root, create=command != "close")
        except RelayError as exc:
            if not _channel_unavailable(exc):
                raise
            return {
                "ok": True,
                "taskPath": task.relative_path,
                "channel": None,
                "channelState": "unavailable",
                "relayWritten": False,
                "action": command,
                "fallback": "Relay Channel unavailable; task artifacts and Git were not modified.",
                "warnings": [str(exc)],
            }
        payload = {"ok": True, "taskPath": task.relative_path, "channel": channel, "channelState": state, "action": command}
        if channel is None:
            payload["fallback"] = "Relay Channel unavailable; task artifacts and Git were not modified."
            return payload
        event = _make_event(task, repo_root, command, actor, mode)
        _send_event(channel, event, repo_root)
        return payload

    raise RelayError(f"Unsupported command: {command}")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Pi-67 bounded Trellis handoff Relay")
    subparsers = parser.add_subparsers(dest="command", required=True)
    ensure = subparsers.add_parser("ensure")
    ensure.add_argument("task", nargs="?")
    ensure.add_argument("--actor", choices=sorted(SYSTEM_ACTORS), default="lifecycle")
    ensure.add_argument("--json", action="store_true")

    resume = subparsers.add_parser("resume")
    resume.add_argument("task", nargs="?")
    resume.add_argument("--platform", required=True, choices=sorted(PLATFORMS))
    resume.add_argument("--mode", required=True, choices=("continue", "review"))
    resume.add_argument("--takeover", action="store_true", help="Records an explicit user-authorized takeover request.")
    resume.add_argument("--json", action="store_true")

    checkpoint = subparsers.add_parser("checkpoint")
    checkpoint.add_argument("task", nargs="?")
    checkpoint.add_argument("--platform", required=True, choices=sorted(PLATFORMS))
    checkpoint.add_argument("--mode", choices=("continue", "review"), default="continue")
    checkpoint.add_argument("--json", action="store_true")

    for name in ("release", "close"):
        action = subparsers.add_parser(name)
        action.add_argument("task", nargs="?")
        action.add_argument("--platform", choices=sorted(PLATFORMS))
        action.add_argument("--actor", choices=sorted(SYSTEM_ACTORS), default="lifecycle")
        action.add_argument("--json", action="store_true")

    status = subparsers.add_parser("status")
    status.add_argument("task", nargs="?")
    status.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        payload = _run_action(args, get_repo_root())
        _output(payload, args.json)
        return 0
    except RelayError as exc:
        payload = {"ok": False, "error": str(exc)}
        _output(payload, getattr(args, "json", False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

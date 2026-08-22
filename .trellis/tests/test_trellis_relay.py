#!/usr/bin/env python3
"""Isolated, no-model-call tests for the project-local Trellis Relay."""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RELAY_PATH = REPO_ROOT / ".trellis" / "scripts" / "trellis_relay.py"
SPEC = importlib.util.spec_from_file_location("trellis_relay", RELAY_PATH)
assert SPEC and SPEC.loader
relay = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = relay
SPEC.loader.exec_module(relay)


class RelayCliTest(unittest.TestCase):
    def setUp(self) -> None:
        if shutil.which("trellis") is None:
            self.skipTest("trellis CLI is not installed")
        self.tempdir = tempfile.TemporaryDirectory()
        self.repo = Path(self.tempdir.name) / "repo"
        self.repo.mkdir()
        (self.repo / ".trellis" / "tasks" / "08-22-relay-test").mkdir(parents=True)
        self.task_dir = self.repo / ".trellis" / "tasks" / "08-22-relay-test"
        self.task = self.task_dir / "task.json"
        self.task.write_text(json.dumps({
            "id": "relay-test", "name": "relay-test", "status": "planning", "createdAt": "2026-08-22"
        }) + "\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True)
        subprocess.run(["git", "config", "user.email", "relay@example.test"], cwd=self.repo, check=True)
        subprocess.run(["git", "config", "user.name", "Relay Test"], cwd=self.repo, check=True)
        subprocess.run(["git", "add", ".trellis/tasks/08-22-relay-test/task.json"], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-qm", "relay fixture"], cwd=self.repo, check=True)
        self.channel_root = Path(self.tempdir.name) / "channels"

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def invoke(
        self,
        *args: str,
        identity: str | None = None,
        hook: bool = False,
        channel_available: bool = True,
        inherited_project: str | None = None,
    ) -> tuple[int, dict]:
        env = {**os.environ, "TRELLIS_CHANNEL_ROOT": str(self.channel_root)}
        if identity:
            env["TRELLIS_CONTEXT_ID"] = identity
        if hook:
            env["TASK_JSON_PATH"] = str(self.task.resolve())
        if inherited_project:
            env["TRELLIS_CHANNEL_PROJECT"] = inherited_project
        if not channel_available:
            env["PATH"] = str(Path(self.tempdir.name) / "no-trellis-bin")
        completed = subprocess.run(
            [sys.executable, str(RELAY_PATH), *args, "--json"], cwd=self.repo, env=env,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        return completed.returncode, json.loads(completed.stdout)

    def test_ensure_resume_status_and_status_neutral_attach(self) -> None:
        task_ref = ".trellis/tasks/08-22-relay-test"
        code, ensured = self.invoke("ensure", task_ref)
        self.assertEqual(code, 0, ensured)
        self.assertEqual(ensured["channelState"], "created")
        self.assertEqual(json.loads(self.task.read_text(encoding="utf-8"))["status"], "planning")

        code, resumed = self.invoke("resume", task_ref, "--platform", "codex", "--mode", "continue", identity="codex_relay_test")
        self.assertEqual(code, 0, resumed)
        self.assertTrue(resumed["attached"])
        self.assertEqual(json.loads(self.task.read_text(encoding="utf-8"))["status"], "planning")

        code, status = self.invoke("status", task_ref)
        self.assertEqual(code, 0, status)
        self.assertEqual(status["eventCount"], 2)
        self.assertFalse(status["handoffDrift"])

    def test_lifecycle_hook_shape_uses_task_json_path_and_stable_actor(self) -> None:
        code, ensured = self.invoke("ensure", hook=True)
        self.assertEqual(code, 0, ensured)
        self.assertEqual(ensured["action"], "ensure")
        code, closed = self.invoke("close", "--actor", "lifecycle", hook=True)
        self.assertEqual(code, 0, closed)
        self.assertEqual(closed["action"], "close")

    def test_platform_release_and_explicit_takeover_are_valid_events(self) -> None:
        task_ref = ".trellis/tasks/08-22-relay-test"
        code, takeover = self.invoke(
            "resume", task_ref, "--platform", "claude", "--mode", "review", "--takeover"
        )
        self.assertEqual(code, 0, takeover)
        self.assertEqual(takeover["action"], "takeover")
        code, released = self.invoke("release", task_ref, "--platform", "claude")
        self.assertEqual(code, 0, released)
        self.assertEqual(released["action"], "release")
        code, status = self.invoke("status", task_ref)
        self.assertEqual(code, 0, status)
        self.assertEqual(status["latestAction"], "release")
        self.assertEqual(status["latestActor"], "claude")

    def test_archived_task_matches_its_pre_archive_channel_reference(self) -> None:
        task_ref = ".trellis/tasks/08-22-relay-test"
        code, ensured = self.invoke("ensure", task_ref)
        self.assertEqual(code, 0, ensured)
        archive_dir = self.repo / ".trellis" / "tasks" / "archive" / "2026-08" / self.task_dir.name
        archive_dir.parent.mkdir(parents=True)
        self.task_dir.rename(archive_dir)
        self.task_dir = archive_dir
        self.task = archive_dir / "task.json"
        code, closed = self.invoke("close", str(self.task), hook=True)
        self.assertEqual(code, 0, closed)
        self.assertEqual(closed["channelState"], "existing")

    def test_zero_and_multiple_channel_candidates_fail_closed(self) -> None:
        task_ref = ".trellis/tasks/08-22-relay-test"
        code, status = self.invoke("status", task_ref)
        self.assertEqual(code, 0, status)
        self.assertEqual(status["channelState"], "missing")
        self.assertIn("fallback", status)

        code, ensured = self.invoke("ensure", task_ref)
        self.assertEqual(code, 0, ensured)
        duplicate = subprocess.run(
            ["trellis", "channel", "create", "relay-duplicate", "--task", task_ref, "--cwd", str(self.repo.resolve()), "--by", "test"],
            cwd=self.repo.resolve(), env={**os.environ, "TRELLIS_CHANNEL_ROOT": str(self.channel_root)}, capture_output=True, text=True,
        )
        self.assertEqual(duplicate.returncode, 0, duplicate.stderr)
        code, result = self.invoke("status", task_ref)
        self.assertEqual(code, 2)
        self.assertIn("Multiple Relay channels", result["error"])

    def test_ephemeral_worker_channel_for_same_task_is_not_a_relay_candidate(self) -> None:
        task_ref = ".trellis/tasks/08-22-relay-test"
        channel_env = {**os.environ, "TRELLIS_CHANNEL_ROOT": str(self.channel_root)}
        channel_env.pop("TRELLIS_CHANNEL_PROJECT", None)
        worker_channel = subprocess.run(
            [
                "trellis", "channel", "create", "check-relay-test-r1",
                "--task", task_ref, "--cwd", str(self.repo.resolve()),
                "--by", "test", "--ephemeral",
            ],
            cwd=self.repo.resolve(), env=channel_env, capture_output=True, text=True,
        )
        self.assertEqual(worker_channel.returncode, 0, worker_channel.stderr)
        code, ensured = self.invoke("ensure", task_ref)
        self.assertEqual(code, 0, ensured)
        self.assertEqual(ensured["channelState"], "created")
        code, status = self.invoke("status", task_ref)
        self.assertEqual(code, 0, status)
        self.assertEqual(status["eventCount"], 1)

    def test_channel_unavailable_reports_explicit_artifact_fallback(self) -> None:
        code, status = self.invoke("status", ".trellis/tasks/08-22-relay-test", channel_available=False)
        self.assertEqual(code, 0, status)
        self.assertEqual(status["channelState"], "unavailable")
        self.assertFalse(status["relayWritten"])
        self.assertIn("fallback", status)

    def test_inherited_worker_project_does_not_misroute_relay_channel(self) -> None:
        task_ref = ".trellis/tasks/08-22-relay-test"
        code, ensured = self.invoke(
            "ensure", task_ref, inherited_project="unrelated-parent-worker-project"
        )
        self.assertEqual(code, 0, ensured)
        code, status = self.invoke(
            "status", task_ref, inherited_project="unrelated-parent-worker-project"
        )
        self.assertEqual(code, 0, status)
        self.assertEqual(status["eventCount"], 1)

    def test_handoff_limits_required_shape_and_drift(self) -> None:
        task_ref = ".trellis/tasks/08-22-relay-test"
        code, ensured = self.invoke("ensure", task_ref)
        self.assertEqual(code, 0, ensured)
        handoff = self.task_dir / "handoff.md"
        handoff.write_text("x" * (relay.MAX_HANDOFF_BYTES + 1), encoding="utf-8")
        code, checkpoint = self.invoke("checkpoint", task_ref, "--platform", "claude")
        self.assertEqual(code, 2)
        self.assertIn("exceeds", checkpoint["error"])

        handoff.write_text("\n".join(f"## {heading}\n- bounded" for heading in relay.HANDOFF_HEADINGS) + "\n", encoding="utf-8")
        code, checkpoint = self.invoke("checkpoint", task_ref, "--platform", "claude")
        self.assertEqual(code, 0, checkpoint)
        handoff.write_text(handoff.read_text(encoding="utf-8") + "\n- changed\n", encoding="utf-8")
        code, status = self.invoke("status", task_ref)
        self.assertEqual(code, 0, status)
        self.assertTrue(status["handoffDrift"])


class RelayValidationTest(unittest.TestCase):
    def test_rejects_unknown_fields_and_sensitive_metadata(self) -> None:
        event = {
            "schema": relay.EVENT_SCHEMA, "eventId": "3b2cc9c9-a37e-4d0a-a5df-c7b8f512eec8", "action": "ensure",
            "taskPath": ".trellis/tasks/08-22-relay-test", "actor": "lifecycle", "mode": "lifecycle",
            "timestamp": "2026-08-22T00:00:00Z", "taskStatus": "planning", "gitHead": None,
            "dirtyDigest": "0" * 64, "handoffPath": ".trellis/tasks/08-22-relay-test/handoff.md",
            "handoffSha256": None, "nextStep": "Read task artifacts and continue in lifecycle mode.",
        }
        self.assertEqual(relay.validate_event(event), event)
        with self.assertRaises(relay.RelayError):
            relay.validate_event({**event, "rawLog": "forbidden"})
        with self.assertRaises(relay.RelayError):
            relay.validate_event({**event, "nextStep": "copy the API key"})


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Lifecycle-boundary tests for project-local Trellis routing metadata."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / ".trellis" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import task as task_cli  # noqa: E402
from common import task_store  # noqa: E402
from common.task_routing import validate_routing_metadata  # noqa: E402


VALID_L1 = {
    "risk_level": "L1",
    "execution_mode": "native",
    "review_mode": "native",
    "handoff_mode": "relay",
}
VALID_L2 = {
    "risk_level": "L2",
    "execution_mode": "native",
    "review_mode": "channel",
    "handoff_mode": "relay",
}


class RoutingValidationTest(unittest.TestCase):
    def test_planning_permits_missing_keys_but_start_requires_all(self) -> None:
        self.assertEqual(validate_routing_metadata({}, require_complete=False), [])
        errors = validate_routing_metadata({}, require_complete=True)
        self.assertEqual(len(errors), 4)
        self.assertIn("meta.risk_level is required", errors[0])
        malformed = validate_routing_metadata({"risk_level": ["L1"]}, require_complete=True)
        self.assertIn("meta.risk_level must be one of", malformed[0])

    def test_create_rejects_invalid_recognized_value_before_creating_task(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = Path(tempdir)
            args = argparse.Namespace(title="Invalid route", meta=["risk_level=L0"])
            with mock.patch.object(task_store, "get_repo_root", return_value=repo_root):
                output = io.StringIO()
                with contextlib.redirect_stderr(output):
                    self.assertEqual(task_store.cmd_create(args), 1)
            self.assertIn("invalid routing metadata", output.getvalue())
            self.assertFalse((repo_root / ".trellis" / "tasks").exists())

    def test_set_meta_rejects_invalid_routing_and_preserves_custom_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = Path(tempdir)
            task_dir = repo_root / ".trellis" / "tasks" / "08-22-route"
            task_dir.mkdir(parents=True)
            task_json = task_dir / "task.json"
            task_json.write_text(json.dumps({"status": "planning", "meta": {"ticket": "PI-67"}}), encoding="utf-8")
            patches = (
                mock.patch.object(task_store, "get_repo_root", return_value=repo_root),
                mock.patch.object(task_store, "resolve_task_dir", return_value=task_dir),
            )
            with patches[0], patches[1]:
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(
                        task_store.cmd_set_meta(SimpleNamespace(dir="route", key="execution_mode", value="worker")),
                        1,
                    )
                    self.assertEqual(
                        task_store.cmd_set_meta(SimpleNamespace(dir="route", key="ticket", value="PI-68")),
                        0,
                    )
            meta = json.loads(task_json.read_text(encoding="utf-8"))["meta"]
            self.assertEqual(meta, {"ticket": "PI-68"})


class RoutingStartBoundaryTest(unittest.TestCase):
    def _write_task(self, repo_root: Path, meta: dict[str, str]) -> Path:
        task_dir = repo_root / ".trellis" / "tasks" / "08-22-route"
        task_dir.mkdir(parents=True)
        (task_dir / "task.json").write_text(
            json.dumps({"id": "route", "status": "planning", "meta": meta}) + "\n",
            encoding="utf-8",
        )
        return task_dir

    def test_invalid_start_does_not_mutate_pointer_status_or_hooks(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = Path(tempdir)
            task_dir = self._write_task(repo_root, {"risk_level": "L1"})
            with (
                mock.patch.object(task_cli, "get_repo_root", return_value=repo_root),
                mock.patch.object(task_cli, "set_active_task") as set_active,
                mock.patch.object(task_cli, "run_task_hooks") as run_hooks,
            ):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(task_cli.cmd_start(SimpleNamespace(dir=str(task_dir))), 1)
            self.assertIn("Routing metadata fail-closed", output.getvalue())
            self.assertEqual(json.loads((task_dir / "task.json").read_text(encoding="utf-8"))["status"], "planning")
            set_active.assert_not_called()
            run_hooks.assert_not_called()

    def test_valid_l1_and_l2_start_in_degraded_no_session_mode(self) -> None:
        for meta in (VALID_L1, VALID_L2):
            with self.subTest(meta=meta), tempfile.TemporaryDirectory() as tempdir:
                repo_root = Path(tempdir)
                task_dir = self._write_task(repo_root, meta)
                with (
                    mock.patch.object(task_cli, "get_repo_root", return_value=repo_root),
                    mock.patch.object(task_cli, "resolve_context_key", return_value=None),
                    mock.patch.object(task_cli, "set_active_task") as set_active,
                    mock.patch.object(task_cli, "run_task_hooks") as run_hooks,
                ):
                    output = io.StringIO()
                    with contextlib.redirect_stdout(output):
                        self.assertEqual(task_cli.cmd_start(SimpleNamespace(dir=str(task_dir))), 0)
                self.assertEqual(json.loads((task_dir / "task.json").read_text(encoding="utf-8"))["status"], "in_progress")
                set_active.assert_not_called()
                run_hooks.assert_called_once()

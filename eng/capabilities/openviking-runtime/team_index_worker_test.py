"""Offline job input tests; no OV import, provider, user profile or runtime launch."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("team_index_worker", Path(__file__).with_name("team_index_worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class TeamIndexJobTest(unittest.TestCase):
    def test_failure_stage_redacts_raw_errors_and_preserves_inner_stage(self):
        for code in range(71, 77):
            with self.assertRaises(worker.WorkerStageFailure) as raised:
                with worker.failure_stage(73):
                    with worker.failure_stage(code):
                        raise ValueError("synthetic secret and document body")
            self.assertEqual(raised.exception.code, code)
            self.assertEqual(str(raised.exception), "Team index stage failed")
            self.assertTrue(raised.exception.__suppress_context__)

    def test_document_wait_uses_only_the_remaining_nonrenewable_job_budget(self):
        self.assertEqual(worker.JOB_TIMEOUT_SECONDS, 240)
        with patch.object(worker.time, "monotonic", side_effect=[10, 42, 250, 251]):
            self.assertEqual(worker.remaining_job_seconds(250), 240)
            self.assertEqual(worker.remaining_job_seconds(250), 208)
            with self.assertRaises(TimeoutError):
                worker.remaining_job_seconds(250)
            with self.assertRaises(TimeoutError):
                worker.remaining_job_seconds(250)

    def test_network_guard_rejects_connect_bind_and_dns_but_allows_inherited_socket_creation(self):
        for event in ("socket.connect", "socket.bind", "socket.getaddrinfo"):
            with self.assertRaisesRegex(RuntimeError, "inherited broker"):
                worker.deny_unbrokered_network(event, ())
        worker.deny_unbrokered_network("socket.__new__", ())

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="new-money-job-input-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / ("a" * 64) / "staging" / "run-test"
        self.root.mkdir(parents=True, mode=0o700)
        content = "Synthetic SOP content"
        self.job = {"schema": "newmoney.team-index-job.v1", "scopeKey": "a" * 64,
                    "embedding": {"endpoint": "https://model.invalid/v1", "model": "fixture", "dimension": 8},
                    "extraction": {"endpoint": "https://model.invalid/v1", "model": "fixture"},
                    "documents": [{"assetId": "00000000-0000-4000-8000-000000000001",
                                   "canonicalContent": content, "contentRevision": hashlib.sha256(content.encode()).hexdigest()}]}

    def write(self, job=None):
        path = self.root / "job.json"
        path.write_text(json.dumps(self.job if job is None else job), encoding="utf-8")
        path.chmod(0o600)
        return path

    def test_valid_bounded_job_is_read_without_mutation(self):
        path = self.write()
        before = path.stat()
        self.assertEqual(worker.read_job(self.root), self.job)
        self.assertEqual(path.stat().st_ctime_ns, before.st_ctime_ns)
        self.assertEqual(set(os.listdir(self.root)), {"job.json"})

    def test_unknown_configuration_and_credentials_are_not_accepted(self):
        for name in ("dataRoot", "bootstrap", "apiKey", "config", "permissionLease"):
            with self.subTest(name=name):
                job = copy.deepcopy(self.job)
                job[name] = "synthetic-unsupported"
                self.write(job)
                with self.assertRaises(ValueError):
                    worker.read_job(self.root)

    def test_scope_and_revision_must_match(self):
        for changes in ({"scopeKey": "b" * 64}, {"schema": "other"}):
            self.write({**self.job, **changes})
            with self.assertRaises(ValueError):
                worker.read_job(self.root)
        self.job["documents"][0]["contentRevision"] = "0" * 64
        self.write()
        with self.assertRaises(ValueError):
            worker.read_job(self.root)

    def test_dimensions_match_the_pinned_local_vectordb(self):
        for dimension in (True, 0, 1, 2, 5, 4097, 65536):
            with self.subTest(dimension=dimension):
                self.job["embedding"]["dimension"] = dimension
                self.write()
                with self.assertRaises(ValueError):
                    worker.read_job(self.root)

    def test_routes_cannot_add_credentials_redirect_targets_or_local_endpoints(self):
        for endpoint in ("http://127.0.0.1/v1", "https://name:password@model.invalid", "https://model.invalid?",
                         "https://model.invalid#", " https://model.invalid", "https://model.invalid\\path"):
            with self.subTest(endpoint=endpoint):
                self.job["embedding"]["endpoint"] = endpoint
                self.write()
                with self.assertRaises(ValueError):
                    worker.read_job(self.root)

    def test_rejects_duplicate_documents_path_names_and_excess_budget(self):
        original = copy.deepcopy(self.job)
        for documents in ([], original["documents"] * 2, original["documents"] * 101,
                          [{**original["documents"][0], "assetId": "../../private"}]):
            self.write({**original, "documents": documents})
            with self.assertRaises(ValueError):
                worker.read_job(self.root)
        path = self.write()
        with path.open("wb") as output:
            output.write(b" " * (worker.MAX_JOB_BYTES + 1))
        with self.assertRaises(ValueError):
            worker.read_job(self.root)

    def test_rejects_nonfresh_directory_without_touching_existing_content(self):
        self.write()
        (self.root / "index").mkdir()
        with self.assertRaises(ValueError):
            worker.read_job(self.root)
        self.assertTrue((self.root / "index").is_dir())

    def test_rejects_shared_permissions_and_symlink_without_repair(self):
        path = self.write()
        path.chmod(0o644)
        with self.assertRaises(ValueError):
            worker.read_job(self.root)
        self.assertEqual(path.stat().st_mode & 0o777, 0o644)
        path.unlink()
        target = Path(self.temporary.name) / "outside"
        target.write_text("retain", encoding="utf-8")
        path.symlink_to(target)
        with self.assertRaises(OSError):
            worker.read_job(self.root)
        self.assertEqual(target.read_text(), "retain")


if __name__ == "__main__":
    unittest.main()

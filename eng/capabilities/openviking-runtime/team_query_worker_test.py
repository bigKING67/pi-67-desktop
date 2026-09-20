"""Offline request/root contract tests. No OV import, models or real profiles."""
import importlib.util
from pathlib import Path
import tempfile
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("query_worker", Path(__file__).with_name("team_query_worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class QueryContractTest(unittest.TestCase):
    def test_query_filters_before_top_k_and_validates_index_and_results(self):
        asset = "00000000-0000-4000-8000-000000000001"
        request = {"schema": "newmoney.team-vector-query.v1", "scopeKey": "a" * 64, "assetIds": [asset], "vector": [0, 1, 0, 0], "limit": 4}
        for mode in ("success", "no-index", "dimension", "directory", "wrong-account", "foreign-asset", "score", "too-many"):
            with self.subTest(mode=mode):
                fields = {"uri": "/resources/" + asset + ".md", "account_id": "team-" + "a" * 64}
                if mode == "directory":
                    fields["uri"] = "/resources"
                if mode == "foreign-asset":
                    fields["uri"] = "/resources/00000000-0000-4000-8000-000000000002.md"
                if mode == "wrong-account":
                    fields["account_id"] = "other"
                item = SimpleNamespace(fields=fields, score=float("nan") if mode == "score" else 0.5)
                collection = SimpleNamespace(has_index=Mock(return_value=mode != "no-index"),
                    get_meta_data=Mock(return_value={"Fields": [{"FieldType": "vector", "Dim": 8 if mode == "dimension" else 4}]}), close=Mock(),
                    search_by_vector=Mock(return_value=SimpleNamespace(data=[item] * (5 if mode == "too-many" else 2))))
                fake = SimpleNamespace(get_or_create_local_collection=Mock(return_value=collection))
                with patch.dict(sys.modules, {"openviking.storage.vectordb.collection.local_collection": fake}):
                    if mode == "success":
                        result = worker.query(Path("synthetic-collection"), request)
                        self.assertEqual(result["hits"], [{"assetId": asset, "score": 0.5}])
                        self.assertEqual(collection.search_by_vector.call_args.kwargs["filters"], {"op": "and", "conds": [
                            {"op": "must", "field": "uri", "conds": ["/resources/" + asset + ".md"], "para": "-d=0"},
                            {"op": "must", "field": "account_id", "conds": ["team-" + "a" * 64]}]})
                    else:
                        with self.assertRaises(ValueError):
                            worker.query(Path("synthetic-collection"), request)
                if mode in ("no-index", "dimension"):
                    collection.search_by_vector.assert_not_called()
                collection.close.assert_called_once()

    def test_valid_request(self):
        value = {"schema": "newmoney.team-vector-query.v1", "scopeKey": "a" * 64,
                 "assetIds": ["00000000-0000-4000-8000-000000000001"], "vector": [0, 1, 0, 0], "limit": 4}
        self.assertEqual(worker.validate_request(value), value)

    def test_invalid_requests(self):
        original = {"schema": "newmoney.team-vector-query.v1", "scopeKey": "a" * 64,
                    "assetIds": ["00000000-0000-4000-8000-000000000001"], "vector": [0, 1, 0, 0], "limit": 4}
        for changes in ({"vector": []}, {"vector": [1] * 5}, {"vector": [1] * 4100}, {"vector": [float("nan")] * 4},
                        {"vector": [float("inf")] * 4}, {"vector": [1e39] * 4}, {"vector": [True] * 4},
                        {"limit": True}, {"limit": 101}, {"limit": 0}, {"prompt": "private"}, {"scopeKey": "../private"},
                        {"assetIds": []}, {"assetIds": ["../private"]}, {"assetIds": original["assetIds"] * 2}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                worker.validate_request({**original, **changes})

    def test_exact_private_copy_only(self):
        with tempfile.TemporaryDirectory(prefix="new-money-query-input-") as temporary:
            owner = Path(temporary) / ("a" * 64)
            staging = owner / "staging"
            root = staging / "query-test"
            collection = root / "index" / "vectordb" / "context"
            for path in (owner, staging, root, root / "index", collection.parent, collection):
                path.mkdir(mode=0o700)
            metadata = collection / "collection_meta.json"
            metadata.write_text("{}")
            metadata.chmod(0o600)
            self.assertEqual(worker.validate_root(root, "a" * 64), collection)
            with self.assertRaises(ValueError):
                worker.validate_root(root, "b" * 64)
            metadata.chmod(0o644)
            with self.assertRaises(ValueError):
                worker.validate_root(root, "a" * 64)
            metadata.chmod(0o600)
            original = root.with_name("run-test")
            root.rename(original)
            with self.assertRaises(ValueError):
                worker.validate_root(original, "a" * 64)
            root.symlink_to(original, target_is_directory=True)
            with self.assertRaises(ValueError):
                worker.validate_root(root, "a" * 64)


if __name__ == "__main__":
    unittest.main()

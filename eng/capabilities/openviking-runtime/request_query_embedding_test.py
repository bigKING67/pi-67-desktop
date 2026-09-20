"""Isolated unit regression for the installed build patch; no HTTP or user data."""

import asyncio
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch


def no_network(event, _args):
    if event in ("socket.connect", "socket.getaddrinfo", "subprocess.Popen", "os.system"):
        raise RuntimeError("Unit probe forbids network and child processes")


sys.addaudithook(no_network)
from openviking.retrieve import request_query_embedding as module
from openviking.models.embedder.openai_embedders import OpenAIDenseEmbedder


class QueryScopeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.calls = 0
        self.embedder = OpenAIDenseEmbedder(model_name="synthetic", api_key="synthetic", dimension=4,
                                          api_base="http://127.0.0.1:1/v1", encoding_format="float")
        self.ctx = SimpleNamespace(account_id="a", user=SimpleNamespace(user_id="u"),
                                   actor_peer_id="p", role="user", from_oauth=False)

        async def invoke(*_args, **kwargs):
            assert kwargs == {"is_query": True}
            self.calls += 1
            await asyncio.sleep(0)
            return [1, 2]

        self.mock = patch.object(module, "embed_compat", invoke)
        self.mock.start()

    def tearDown(self):
        self.mock.stop()
        self.embedder.client.close()

    async def query(self, query="synthetic"):
        return await module.embed_query_once(self.embedder, query, ctx=self.ctx)

    async def test_coalescing_copies_and_fresh_concurrent_scopes(self):
        @module.query_embedding_scope
        async def operation():
            values = await asyncio.gather(*(self.query() for _ in range(8)))
            values[0][0] = 9
            self.assertEqual(await self.query(), [1, 2])
            self.assertEqual(values[1], [1, 2])
        await asyncio.gather(operation(), operation())
        self.assertEqual(self.calls, 2)
        await operation()
        self.assertEqual(self.calls, 3)

    async def test_identity_model_query_and_config_changes(self):
        @module.query_embedding_scope
        async def operation():
            await self.query()
            await self.query("different")
            for attribute, value in (("account_id", "b"), ("actor_peer_id", "q"),
                                     ("role", "admin"), ("from_oauth", True)):
                setattr(self.ctx, attribute, value)
                await self.query()
            self.ctx.user.user_id = "v"
            await self.query()
            self.embedder.model_name = "other"
            await self.query()
            self.embedder.dimension = 8
            await self.query()
            self.embedder._client_kwargs["base_url"] = "http://127.0.0.1:2/v1"
            await self.query()
            self.embedder._client_kwargs["api_key"] = "other-synthetic"
            await self.query()
            self.embedder.extra_body = {"task": "other"}
            await self.query()
            for attribute, value in (("max_input_tokens", 128), ("max_retries", 0),
                                     ("max_concurrent", 2), ("_provider", "azure")):
                setattr(self.embedder, attribute, value)
                await self.query()
        await operation()
        self.assertEqual(self.calls, 16)

    async def test_bypass_and_capacity_do_not_reject_valid_upstream_work(self):
        await self.query(); await self.query()
        self.assertEqual(self.calls, 2)

        @module.query_embedding_scope
        async def operation():
            for query in (["image"], "a" * 16385):
                await self.query(query); await self.query(query)
            self.embedder._client_kwargs["unsupported"] = object()
            await self.query(); await self.query()
            del self.embedder._client_kwargs["unsupported"]
            for index in range(33):
                await self.query(str(index))
            await self.query("32")  # Overflow is uncached, never rejected.
            await module.embed_query_once(object(), "synthetic", ctx=self.ctx)
        await operation()
        self.assertEqual(self.calls, 43)

    async def test_shared_failure_no_extra_retry_and_next_scope_recovers(self):
        calls = 0

        async def fail(*_args, **_kwargs):
            nonlocal calls
            calls += 1
            raise ValueError("synthetic")

        @module.query_embedding_scope
        async def operation():
            errors = await asyncio.gather(*(self.query() for _ in range(8)), return_exceptions=True)
            self.assertTrue(all(isinstance(error, ValueError) for error in errors))
            with self.assertRaises(ValueError):
                await self.query()
        with patch.object(module, "embed_compat", fail):
            await operation()
            self.assertEqual(calls, 1)
            await operation()
            self.assertEqual(calls, 2)
        self.assertEqual(await self.query(), [1, 2])

    async def test_waiter_cancel_does_not_cancel_sibling(self):
        started, release = asyncio.Event(), asyncio.Event()

        async def blocked():
            started.set()
            await release.wait()
            return [1]
        scope = module.QueryEmbeddingScope()
        first = asyncio.create_task(scope.get("k", blocked))
        await started.wait()
        second = asyncio.create_task(scope.get("k", blocked))
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        release.set()
        self.assertEqual(await second, [1])
        await scope.close()
        self.assertFalse(scope.tasks)
        with self.assertRaises(RuntimeError):
            await scope.get("k", blocked)

    async def test_scope_cancel_cleans_pending_work(self):
        started, stopped = asyncio.Event(), asyncio.Event()

        async def blocked(*_args, **_kwargs):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()

        @module.query_embedding_scope
        async def operation():
            await self.query()
        with patch.object(module, "embed_compat", blocked):
            task = asyncio.create_task(operation())
            await started.wait()
            task.cancel()
            result = await asyncio.gather(task, return_exceptions=True)
            self.assertIsInstance(result[0], asyncio.CancelledError)
            self.assertTrue(stopped.is_set())
        self.assertIsNone(module._scope.get())

    async def test_nested_scope_restores_outer_scope(self):
        @module.query_embedding_scope
        async def inner():
            await self.query()

        @module.query_embedding_scope
        async def outer():
            await self.query()
            await inner()
            await self.query()
        await outer()
        self.assertEqual(self.calls, 2)
        self.assertIsNone(module._scope.get())

    async def test_noncooperative_cleanup_reports_failure(self):
        started, release = asyncio.Event(), asyncio.Event()

        async def blocked():
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                await release.wait()
            return [1]

        scope = module.QueryEmbeddingScope()
        waiter = asyncio.create_task(scope.get("k", blocked))
        await started.wait()
        try:
            with self.assertRaisesRegex(RuntimeError, "cleanup incomplete"):
                await scope.close()
        finally:
            release.set()
            await waiter
        self.assertTrue(scope.closed)


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(QueryScopeTests))
    if not result.wasSuccessful():
        sys.exit(1)
    print("QUERY_SCOPE_TESTS_PASS")

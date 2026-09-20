"""Offline real-backend probe. Run with the pinned runtime Python, -I -B.

No provider credentials, OpenViking server, profile, socket or model service used.
"""
import asyncio
import importlib.util
from importlib.metadata import version
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import httpx
from openviking.models.embedder import openai_embedders
from openviking.models.vlm.backends import openai_vlm

spec = importlib.util.spec_from_file_location("team_model_transport", Path(__file__).with_name("team_model_transport.py"))
adapter = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = adapter
spec.loader.exec_module(adapter)


class TeamModelTransportTest(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        if version("openviking") != "0.4.16" or sys.version_info[:3] != (3, 12, 10):
            raise RuntimeError("This probe requires pinned OpenViking 0.4.16 / Python 3.12.10")

    def facade(self, purpose):
        route = adapter.ModelRoute(purpose, "https://model.invalid/v1", "fixture")
        calls = []

        def exchange(binding, body):
            calls.append((binding.purpose, json.loads(body)))
            result = {"data": [{"index": 0, "embedding": [0.25, 0.75]}], "model": "fixture", "usage": {"prompt_tokens": 1, "total_tokens": 1}}
            if purpose == "extraction":
                result = {"id": "fixture", "object": "chat.completion", "created": 0, "model": "fixture",
                          "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "synthetic summary"}}],
                          "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}
            return 200, json.dumps(result).encode()

        async def exchange_async(binding, body):
            return exchange(binding, body)

        return adapter.TeamOpenAIClients(route, exchange, exchange_async), calls

    async def test_real_embedder_sync_and_async(self):
        facade, calls = self.facade("embedding")
        with patch.object(openai_embedders, "openai", facade):
            embedder = openai_embedders.OpenAIDenseEmbedder(model_name="fixture", api_key="team-broker-only",
                        api_base=facade.route.endpoint, dimension=2, encoding_format="float")
            self.assertEqual(embedder.embed("synthetic document").dense_vector, [0.25, 0.75])
            self.assertEqual((await embedder.embed_async("synthetic query")).dense_vector, [0.25, 0.75])
            embedder.client.close()
            await embedder._get_async_client().close()
        self.assertEqual([purpose for purpose, _ in calls], ["embedding", "embedding"])

    async def test_real_vlm_sync_and_async(self):
        facade, calls = self.facade("extraction")
        with patch.object(openai_vlm, "openai", facade):
            backend = openai_vlm.OpenAIVLM({"provider": "openai", "model": "fixture", "api_key": "team-broker-only",
                                          "api_base": facade.route.endpoint, "max_retries": 0})
            self.assertEqual(backend.get_completion("synthetic document"), "synthetic summary")
            self.assertEqual(await backend.get_completion_async("synthetic document"), "synthetic summary")
            backend.get_client().close()
            await backend.get_async_client().close()
        self.assertEqual([purpose for purpose, _ in calls], ["extraction", "extraction"])

    def test_wrong_route_model_and_redirect_never_fall_back(self):
        facade, calls = self.facade("embedding")
        transport = adapter.TeamSyncTransport(facade.route, facade.exchange)
        for url, model in [("https://other.invalid/v1/embeddings", "fixture"),
                           ("https://model.invalid/v1/chat/completions", "fixture"),
                           ("https://model.invalid/v1/embeddings", "other")]:
            with self.assertRaises(ValueError):
                transport.handle_request(httpx.Request("POST", url, json={"model": model, "input": "synthetic"}))
        self.assertEqual(calls, [])
        with self.assertRaises(ValueError):
            adapter.response_for(httpx.Request("POST", "https://model.invalid/v1/embeddings"), (302, b""))

    async def test_async_cancel_reaches_exchange(self):
        facade, _ = self.facade("embedding")
        started, cancelled = asyncio.Event(), asyncio.Event()

        async def pending(_route, _body):
            started.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        transport = adapter.TeamAsyncTransport(facade.route, pending)
        task = asyncio.create_task(transport.handle_async_request(httpx.Request("POST", "https://model.invalid/v1/embeddings", json={"model": "fixture"})))
        await asyncio.wait_for(started.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(cancelled.is_set())

    async def test_real_vlm_retries_reenter_the_exchange(self):
        facade, calls = self.facade("extraction")
        attempts = []
        success = facade.exchange

        def retry_once(route, body):
            attempts.append(route.purpose)
            return (503, b"sensitive provider diagnostic") if len(attempts) % 2 else success(route, body)

        async def retry_once_async(route, body):
            return retry_once(route, body)

        facade.exchange, facade.exchange_async = retry_once, retry_once_async
        with patch.object(openai_vlm, "openai", facade):
            backend = openai_vlm.OpenAIVLM({"provider": "openai", "model": "fixture", "api_key": "team-broker-only",
                                          "api_base": facade.route.endpoint, "max_retries": 1})
            self.assertEqual(backend.get_completion("synthetic"), "synthetic summary")
            self.assertEqual(await backend.get_completion_async("synthetic"), "synthetic summary")
            backend.get_client().close()
            await backend.get_async_client().close()
        self.assertEqual(attempts, ["extraction"] * 4)
        self.assertEqual(len(calls), 2)

    def test_bounds_and_unsupported_configuration_fail_closed(self):
        facade, calls = self.facade("embedding")
        with self.assertRaises(ValueError):
            facade.OpenAI(api_key="team-broker-only", base_url=facade.route.endpoint, default_headers={"x-extra": "unsupported"})
        transport = adapter.TeamSyncTransport(facade.route, facade.exchange)
        with self.assertRaises(ValueError):
            transport.handle_request(httpx.Request("POST", facade.route.endpoint + "/embeddings", content=b"x" * (adapter.MAX_BYTES + 1)))
        self.assertEqual(calls, [])
        request = httpx.Request("POST", facade.route.endpoint + "/embeddings")
        with self.assertRaises(ValueError):
            adapter.response_for(request, (200, b"x" * (adapter.MAX_BYTES + 1)))
        self.assertNotIn(b"sensitive", adapter.response_for(request, (500, b"sensitive")).content)

    async def test_broker_exception_does_not_disclose_diagnostic_content(self):
        facade, _ = self.facade("embedding")

        def fail(_route, _body):
            raise RuntimeError("sensitive synthetic diagnostic")

        async def fail_async(route, body):
            return fail(route, body)

        request = httpx.Request("POST", facade.route.endpoint + "/embeddings", json={"model": "fixture"})
        with self.assertRaisesRegex(RuntimeError, "^Team model broker unavailable$"):
            adapter.TeamSyncTransport(facade.route, fail).handle_request(request)
        with self.assertRaisesRegex(RuntimeError, "^Team model broker unavailable$"):
            await adapter.TeamAsyncTransport(facade.route, fail_async).handle_async_request(request)


if __name__ == "__main__":
    unittest.main()

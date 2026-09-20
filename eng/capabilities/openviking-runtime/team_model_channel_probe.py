"""Synthetic-only cross-language probe; FD 3 is supplied by the owning test."""
import asyncio
import importlib.util
from importlib.metadata import version
from pathlib import Path
import sys
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


async def main():
    if version("openviking") != "0.4.16" or sys.version_info[:3] != (3, 12, 10):
        raise RuntimeError("Pinned runtime required")
    adapter, ipc = load("team_model_transport"), load("team_model_channel")
    from openviking.models.embedder import openai_embedders
    from openviking.models.vlm.backends import openai_vlm
    channel = ipc.TeamModelChannel(3, timeout=10)
    mode = sys.argv[1]
    try:
        for purpose in ["embedding", "extraction"]:
            route = adapter.ModelRoute(purpose, "https://model.invalid/v1", "fixture")
            facade = adapter.TeamOpenAIClients(route, channel.exchange, channel.exchange_async)
            if purpose == "embedding":
                with patch.object(openai_embedders, "openai", facade):
                    backend = openai_embedders.OpenAIDenseEmbedder(model_name="fixture", api_key="team-broker-only",
                        api_base=route.endpoint, dimension=2, encoding_format="float", config={"max_retries": 0})
                    try:
                        if mode == "cancel":
                            await backend.embed_async("synthetic document")
                        else:
                            assert backend.embed("synthetic document").dense_vector == [0.25, 0.75]
                            assert (await backend.embed_async("synthetic query")).dense_vector == [0.25, 0.75]
                    finally:
                        backend.client.close()
                        await backend._get_async_client().close()
            else:
                with patch.object(openai_vlm, "openai", facade):
                    backend = openai_vlm.OpenAIVLM({"provider": "openai", "model": "fixture", "api_key": "team-broker-only",
                        "api_base": route.endpoint, "max_retries": 0})
                    try:
                        assert backend.get_completion("synthetic document") == "synthetic summary"
                        assert await backend.get_completion_async("synthetic document") == "synthetic summary"
                    finally:
                        backend.get_client().close()
                        await backend.get_async_client().close()
        assert mode == "success"
        print("TEAM_CHANNEL_PASS:success")
    except Exception:
        if mode not in ("deny", "cancel") or not channel.stopped:
            raise RuntimeError("Synthetic team channel probe failed") from None
        print("TEAM_CHANNEL_PASS:" + mode)
    finally:
        channel.stop()
        # asyncio.run waits for exchange threads before process teardown.


asyncio.run(main())

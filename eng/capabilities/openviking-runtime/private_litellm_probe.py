"""Opt-in fixture probe. Never installed in the signed runtime or sent user data."""

import asyncio
import contextlib
import importlib.abc
import json
import logging
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

stage = "setup"
allowed_port = None
denied_connections = 0


def network_boundary(event, args):
    global denied_connections
    if event == "socket.connect":
        address = args[1]
        if not isinstance(address, tuple) or address[:2] != ("127.0.0.1", allowed_port):
            denied_connections += 1
            raise RuntimeError("Probe forbids non-fixture connections")
    elif event == "socket.getaddrinfo" and args[0] != "127.0.0.1":
        denied_connections += 1
        raise RuntimeError("Probe forbids external name resolution")


def missing_dependency():
    global stage

    class MissingLiteLLM(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path=None, target=None):
            if fullname == "litellm" or fullname.startswith("litellm."):
                raise ModuleNotFoundError("Synthetic absent dependency", name="litellm")
            return None

    sys.meta_path.insert(0, MissingLiteLLM())
    stage = "missing-bootstrap"
    import openviking.server.bootstrap  # noqa: F401
    from openviking.models.embedder import LiteLLMDenseEmbedder, OpenAIDenseEmbedder
    from openviking.models.vlm import OpenAIVLM, VLMFactory
    from openviking_cli.utils.config.embedding_config import EmbeddingConfig, EmbeddingModelConfig

    config = {"provider": "openai", "model": "synthetic", "api_key": "synthetic-key", "api_base": "http://127.0.0.1:1/v1"}
    embedding = EmbeddingModelConfig(**config, dimension=8)
    factory = EmbeddingConfig(dense=embedding, max_retries=0)
    assert LiteLLMDenseEmbedder is None
    assert isinstance(factory._create_embedder("openai", "dense", embedding), OpenAIDenseEmbedder)
    assert isinstance(VLMFactory.create(config), OpenAIVLM)
    stage = "missing-selection"
    try:
        factory._create_embedder("litellm", "dense", embedding)
    except ValueError as error:
        assert "LiteLLM is not installed" in str(error)
    else:
        raise AssertionError("Missing embedding dependency must fail")
    try:
        VLMFactory.create({**config, "provider": "litellm"})
    except ModuleNotFoundError as error:
        assert error.name == "litellm"
    else:
        raise AssertionError("Missing VLM dependency must fail")
    assert "litellm" not in sys.modules
    return {"mode": "missing", "checks": 4}


def requests():
    global allowed_port, stage
    counts = {"chat": 0, "embedding": 0, "rejected": 0, "unexpected": 0}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 65536:
                counts["unexpected"] += 1
                self.send_error(400)
                return
            body = json.loads(self.rfile.read(length))
            kind = {"/v1/chat/completions": "chat", "/v1/embeddings": "embedding"}.get(self.path)
            valid = kind is not None and body.get("model") == f"probe-{kind}"
            valid = valid and (any(message.get("content") == "NM-LITELLM-REQUEST" for message in body.get("messages", []))
                               if kind == "chat" else body.get("input") == ["NM-LITELLM-REQUEST"])
            auth = self.headers.get("Authorization")
            if not valid or auth not in ("Bearer synthetic-key", "Bearer rejected-key"):
                counts["unexpected"] += 1
                status, response = 400, {"error": {"message": "unexpected fixture request"}}
            elif auth == "Bearer rejected-key":
                counts["rejected"] += 1
                status, response = 401, {"error": {"message": "fixture denial", "type": "authentication_error", "code": "invalid_api_key"}}
            else:
                counts[kind] += 1
                status = 200
                response = {"model": body["model"], "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}
                if kind == "chat":
                    response.update(id="fixture", object="chat.completion", created=1,
                                    choices=[{"index": 0, "message": {"role": "assistant", "content": "NM-LITELLM-REPLY"}, "finish_reason": "stop"}])
                else:
                    response.update(object="list", data=[{"object": "embedding", "index": 0, "embedding": [1.0] + [0.0] * 7}])
            encoded = json.dumps(response).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    allowed_port = server.server_port
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        stage = "request-imports"
        from litellm import AuthenticationError
        from openviking.models.vlm import VLMFactory
        from openviking_cli.utils.config.embedding_config import EmbeddingConfig, EmbeddingModelConfig

        endpoint = f"http://127.0.0.1:{allowed_port}/v1"

        def clients(key):
            config = {"provider": "litellm", "api_key": key, "api_base": endpoint, "max_retries": 0, "timeout": 5}
            vlm = VLMFactory.create({**config, "model": "openai/probe-chat"})
            embedding = EmbeddingModelConfig(provider="litellm", model="openai/probe-embedding", api_key=key, api_base=endpoint, dimension=8)
            embedder = EmbeddingConfig(dense=embedding, max_retries=0)._create_embedder("litellm", "dense", embedding)
            return vlm, embedder

        good_vlm, good_embedder = clients("synthetic-key")
        bad_vlm, bad_embedder = clients("rejected-key")
        stage = "sync-success"
        assert good_vlm.get_completion("NM-LITELLM-REQUEST") == "NM-LITELLM-REPLY"
        assert good_embedder.embed("NM-LITELLM-REQUEST").dense_vector == [1.0] + [0.0] * 7
        stage = "sync-denial"
        for call in (bad_vlm.get_completion, bad_embedder.embed):
            try:
                call("NM-LITELLM-REQUEST")
            except (AuthenticationError, RuntimeError) as error:
                assert isinstance(error, AuthenticationError) or isinstance(error.__cause__, AuthenticationError)
            else:
                raise AssertionError("Denial must not return success")

        async def async_requests():
            global stage
            stage = "async-success"
            assert await good_vlm.get_completion_async("NM-LITELLM-REQUEST") == "NM-LITELLM-REPLY"
            assert (await good_embedder.embed_async("NM-LITELLM-REQUEST")).dense_vector == [1.0] + [0.0] * 7
            stage = "async-denial"
            for call in (bad_vlm.get_completion_async, bad_embedder.embed_async):
                try:
                    await call("NM-LITELLM-REQUEST")
                except (AuthenticationError, RuntimeError) as error:
                    assert isinstance(error, AuthenticationError) or isinstance(error.__cause__, AuthenticationError)
                else:
                    raise AssertionError("Async denial must not return success")

        asyncio.run(async_requests())
        stage = "request-counts"
        assert counts == {"chat": 2, "embedding": 2, "rejected": 4, "unexpected": 0}
        return {"mode": "requests", **counts}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        assert not thread.is_alive()


if __name__ == "__main__":
    sys.addaudithook(network_boundary)
    logging.disable(logging.CRITICAL)
    # Libraries may print response/error bodies. Only the fixed result is emitted.
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        try:
            assert len(sys.argv) == 2 and sys.argv[1] in ("requests", "missing")
            result = requests() if sys.argv[1] == "requests" else missing_dependency()
            assert denied_connections == 0
            result = {"status": "PASS", **result, "deniedConnections": denied_connections}
        except Exception as error:
            result = {"status": "FAIL", "stage": stage, "errorType": type(error).__name__}
    print(json.dumps(result))
    sys.exit(0 if result["status"] == "PASS" else 1)

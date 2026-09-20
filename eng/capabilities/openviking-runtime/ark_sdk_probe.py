"""Isolated Ark dependency-closure/request probe; synthetic loopback models only."""
import asyncio
import contextlib
import json
import logging
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

allowed_port = None
denied_connections = 0


def network_boundary(event, args):
    global denied_connections
    if event == "socket.connect":
        address = args[1]
        if not isinstance(address, tuple) or address[:2] != ("127.0.0.1", allowed_port):
            denied_connections += 1
            raise RuntimeError("External connection forbidden")
    elif event == "socket.getaddrinfo" and args[0] != "127.0.0.1":
        denied_connections += 1
        raise RuntimeError("External resolution forbidden")


def probe():
    global allowed_port
    # Team bootstraps import LiteLLM eagerly. Keep this offline fixture on its
    # bundled cost map instead of attempting GitHub during module import.
    os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
    counts = {"chat": 0, "embedding": 0, "rejected": 0}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            assert body["model"] == "fixture"
            if self.headers.get("Authorization") == "Bearer rejected":
                counts["rejected"] += 1
                self.send_response(401)
                result = {"error": {"message": "fixture denial", "type": "authentication_error"}}
            else:
                assert self.headers.get("Authorization") == "Bearer synthetic"
                self.send_response(200)
                if self.path == "/v1/chat/completions":
                    counts["chat"] += 1
                    result = {"id": "fixture", "object": "chat.completion", "created": 1, "model": "fixture",
                              "choices": [{"index": 0, "message": {"role": "assistant", "content": "fixture reply"}, "finish_reason": "stop"}]}
                elif self.path == "/v1/embeddings":
                    counts["embedding"] += 1
                    result = {"object": "list", "model": "fixture", "data": [{"object": "embedding", "index": 0, "embedding": [1, 0, 0, 0]}],
                              "usage": {"prompt_tokens": 1, "total_tokens": 1}}
                else:
                    raise AssertionError("Unexpected fixture operation")
            payload = json.dumps(result).encode()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    allowed_port = server.server_port
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        from volcenginesdkarkruntime import Ark, AsyncArk
        from volcenginesdkarkruntime._exceptions import ArkAuthenticationError
        from volcenginesdkark import ARKApi
        from volcenginesdkcore import Configuration
        from openviking.models.embedder.volcengine_embedders import VolcengineDenseEmbedder
        import openviking.models.vlm.backends.volcengine_vlm  # noqa: F401
        import openviking.models.vlm.backends.volcengine_media  # noqa: F401

        assert ARKApi() is not None and Configuration() is not None
        endpoint = f"http://127.0.0.1:{allowed_port}/v1"
        messages = [{"role": "user", "content": "fixture request"}]
        with Ark(api_key="synthetic", base_url=endpoint, max_retries=0, timeout=5) as client:
            assert client.chat.completions.create(model="fixture", messages=messages).choices[0].message.content == "fixture reply"
        embedder = VolcengineDenseEmbedder(model_name="fixture", api_key="synthetic", api_base=endpoint,
                                         dimension=4, input_type="text", config={"max_retries": 0})
        try:
            assert embedder.embed("fixture request").dense_vector == [1, 0, 0, 0]
        finally:
            embedder.client.close()
        with Ark(api_key="rejected", base_url=endpoint, max_retries=0, timeout=5) as client:
            try:
                client.chat.completions.create(model="fixture", messages=messages)
            except ArkAuthenticationError:
                pass
            else:
                raise AssertionError("Authentication denial must propagate")

        async def asynchronous():
            async with AsyncArk(api_key="synthetic", base_url=endpoint, max_retries=0, timeout=5) as client:
                assert (await client.chat.completions.create(model="fixture", messages=messages)).choices[0].message.content == "fixture reply"
                assert (await client.embeddings.create(model="fixture", input="fixture request")).data[0].embedding == [1, 0, 0, 0]
        asyncio.run(asynchronous())
        assert counts == {"chat": 2, "embedding": 2, "rejected": 1}
        assert denied_connections == 0
        return {"status": "PASS", **counts, "deniedConnections": denied_connections}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        assert not thread.is_alive()


if __name__ == "__main__":
    sys.addaudithook(network_boundary)
    logging.disable(logging.CRITICAL)
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        try:
            result = probe()
        except Exception as error:
            result = {"status": "FAIL", "errorType": type(error).__name__}
    print(json.dumps(result))
    sys.exit(0 if result["status"] == "PASS" else 1)

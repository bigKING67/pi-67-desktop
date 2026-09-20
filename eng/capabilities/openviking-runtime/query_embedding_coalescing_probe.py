"""Opt-in synthetic HTTP/gather experiment. No installed runtime edits or real models."""

import asyncio
import contextlib
import hashlib
import json
import logging
import os
from pathlib import Path
import statistics
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

from query_embedding_batch_experiment import RequestEmbeddingBatch

allowed_port = None
denied = 0
fixture = Path(os.environ["NM_EMBEDDING_PROBE_ROOT"]).resolve(strict=True)
if Path.cwd() != fixture or Path(os.environ["HOME"]) != fixture:
    raise RuntimeError("Requires an isolated fixture cwd and home")


def boundary(event, args):
    global denied
    if event == "socket.connect":
        address = args[1]
        if not isinstance(address, tuple) or address[:2] != ("127.0.0.1", allowed_port):
            denied += 1
            raise RuntimeError("External network prohibited")
    elif event == "socket.getaddrinfo" and args[0] != "127.0.0.1":
        denied += 1
        raise RuntimeError("External DNS prohibited")
    elif event in ("subprocess.Popen", "os.system"):
        raise RuntimeError("Child processes prohibited")
    elif event == "open" and isinstance(args[0], (str, bytes)):
        mode, flags = args[1], args[2]
        writing = (isinstance(mode, str) and any(c in mode for c in "wax+")) or (
            isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC))
        if writing and not Path(os.fsdecode(args[0])).resolve().is_relative_to(fixture):
            raise RuntimeError("Writes outside fixture prohibited")


sys.addaudithook(boundary)
logging.disable(logging.CRITICAL)
counts = {"requests": 0, "unexpected": 0}
capacity = threading.Semaphore(32)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        if self.path != "/v1/embeddings" or not 0 < length < 65536:
            counts["unexpected"] += 1
            self.send_error(400)
            return
        body = json.loads(self.rfile.read(length))
        if body.get("input") != "SYNTHETIC WEEKLY STRUCTURE" or body.get("model") != "probe-embedding":
            counts["unexpected"] += 1
            self.send_error(400)
            return
        counts["requests"] += 1
        with capacity:
            time.sleep(0.05)  # Explicit simulated provider service time, not a real benchmark.
            response = {"object": "list", "model": "probe-embedding", "usage": {"prompt_tokens": 1, "total_tokens": 1},
                        "data": [{"object": "embedding", "index": 0, "embedding": [1.0, 0.0, 0.0, 0.0]}]}
            encoded = json.dumps(response).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)


class FixtureHTTPServer(ThreadingHTTPServer):
    request_queue_size = 64
    daemon_threads = True


async def safety_checks():
    calls = 0

    async def result():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)
        return [1, 2]

    batch = RequestEmbeddingBatch()
    options = {"identity": ("profile", "account", "user", "peer", "permission-1"),
               "model": ("endpoint", "model", 4, "config-1"), "query": "synthetic", "invoke": result}
    values = await asyncio.gather(*(batch.get(**options) for _ in range(8)))
    assert calls == 1
    values[0][0] = 9
    assert values[1] == [1, 2] and await batch.get(**options) == [1, 2]
    await batch.get(**{**options, "identity": ("profile", "other-account", "user", "peer", "permission-1")})
    await batch.get(**{**options, "model": ("endpoint", "model", 8, "config-2")})
    await batch.get(**{**options, "query": "different"})
    assert calls == 4
    await batch.close()
    assert not batch.tasks
    try:
        await batch.get(**options)
        raise AssertionError("Closed scope accepted work")
    except RuntimeError:
        pass
    fresh = RequestEmbeddingBatch()
    await fresh.get(**options)
    assert calls == 5
    await fresh.close()

    async def fail():
        nonlocal calls
        calls += 1
        raise ValueError("synthetic failure")

    failed = RequestEmbeddingBatch()
    errors = await asyncio.gather(*(failed.get(**{**options, "invoke": fail}) for _ in range(4)), return_exceptions=True)
    assert calls == 6 and all(isinstance(error, ValueError) for error in errors)
    again = await asyncio.gather(failed.get(**{**options, "invoke": fail}), return_exceptions=True)
    assert calls == 6 and isinstance(again[0], ValueError)
    await failed.close()
    limited = RequestEmbeddingBatch(capacity=1)
    await limited.get(**options)
    try:
        await limited.get(**{**options, "query": "over limit"})
        raise AssertionError("Capacity not enforced")
    except RuntimeError:
        pass
    await limited.close()

    left, right = RequestEmbeddingBatch(), RequestEmbeddingBatch()
    before = calls
    await asyncio.gather(left.get(**options), right.get(**options))
    assert calls == before + 2
    await left.close(); await right.close()

    entered, release, cancelled = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def blocked():
        entered.set()
        try:
            await release.wait()
            return [3]
        finally:
            cancelled.set()

    shared = RequestEmbeddingBatch()
    opts = {**options, "invoke": blocked}
    first, second = asyncio.create_task(shared.get(**opts)), asyncio.create_task(shared.get(**opts))
    await entered.wait()
    first.cancel()
    await asyncio.gather(first, return_exceptions=True)
    assert not cancelled.is_set()
    release.set()
    assert await second == [3]
    await shared.close()
    entered.clear(); release.clear(); cancelled.clear()
    closing = RequestEmbeddingBatch()
    waiting = asyncio.create_task(closing.get(**opts))
    await entered.wait()
    await closing.close()
    assert cancelled.is_set() and not closing.tasks
    assert isinstance((await asyncio.gather(waiting, return_exceptions=True))[0], asyncio.CancelledError)
    return {"coalescing": True, "identityModelQueryIsolation": True, "copyIsolation": True,
            "requestLifetime": True, "sharedFailure": True, "capacity": True,
            "waiterCancellation": True, "scopeCancellation": True}


async def experiment(endpoint):
    from openviking.models.embedder.openai_embedders import OpenAIDenseEmbedder
    from openviking.models.embedder.base import embed_compat
    from openviking.retrieve.context_assembler.gather import gather_candidates
    from openviking.server.identity import RequestContext, Role
    from openviking_cli.session.user_id import UserIdentifier

    embedder = OpenAIDenseEmbedder(model_name="probe-embedding", api_key="synthetic-key", api_base=endpoint,
                                 dimension=4, encoding_format="float", config={"max_retries": 0, "timeout": 5})
    ctx = RequestContext(user=UserIdentifier("fixture-account", "fixture-user"), role=Role.USER, actor_peer_id="fixture-peer")
    rows = []

    async def run(optimized, slots):
        global capacity
        capacity = threading.Semaphore(slots)
        counts["requests"] = 0
        batch = RequestEmbeddingBatch()

        async def find(**args):
            identity = args["ctx"]
            async def invoke():
                return await embed_compat(embedder, args["query"], is_query=True)
            vector = await batch.get(identity=(identity.account_id, identity.user.user_id, identity.actor_peer_id),
                                     model=(endpoint, "probe-embedding", 4), query=args["query"], invoke=invoke) if optimized else await invoke()
            assert vector.dense_vector == [1.0, 0.0, 0.0, 0.0]
            # Deterministic vector-store fixture, not a real DB/semantic quality claim.
            return {"memories": [{"uri": args["target_uri"] + "/fixture.md", "score": 0.8,
                                  "abstract": "synthetic candidate", "level": 2}]}

        started = time.perf_counter()
        try:
            candidates, stats = await gather_candidates(service=SimpleNamespace(search=SimpleNamespace(find=find)),
                ctx=ctx, queries=["SYNTHETIC WEEKLY STRUCTURE"], quotas={"preferences": 2, "entities": 2, "events": 2, "cases": 2},
                limit=8, score_threshold=0.1, peer_scope="actor")
            assert not stats.get("retrieval_errors"), stats.get("retrieval_errors")
            projected = [(c.uri, c.score, c.ranked_score, c.category, c.origin, c.abstract) for c in candidates]
            digest = hashlib.sha256(json.dumps(projected, sort_keys=True).encode()).hexdigest()
            rows.append({"optimized": optimized, "simulatedProviderSlots": slots, "httpRequests": counts["requests"],
                         "durationMs": round((time.perf_counter() - started) * 1000), "candidates": len(candidates), "resultHash": digest})
        finally:
            await batch.close()

    try:
        # Exclude first SDK/client construction from measured pairs.
        await embed_compat(embedder, "SYNTHETIC WEEKLY STRUCTURE", is_query=True)
        summaries = []
        for slots in (32, 2):
            for repetition in range(5):
                for optimized in ((False, True) if repetition % 2 == 0 else (True, False)):
                    await run(optimized, slots)
            samples = [row for row in rows if row["simulatedProviderSlots"] == slots]
            before = [row for row in samples if not row["optimized"]]
            after = [row for row in samples if row["optimized"]]
            assert all(row["httpRequests"] == 8 for row in before)
            assert all(row["httpRequests"] == 1 for row in after)
            assert all(row["candidates"] == 8 for row in samples)
            assert len({row["resultHash"] for row in samples}) == 1
            summaries.append({"simulatedProviderSlots": slots, "pairs": 5, "requestsBefore": 8, "requestsAfter": 1,
                "medianBeforeMs": statistics.median(row["durationMs"] for row in before),
                "medianAfterMs": statistics.median(row["durationMs"] for row in after),
                "allResultsEqual": True})
        return {"simulatedServiceMs": 50, "warmupRequests": 1, "comparisons": summaries,
                "samples": rows, "safety": await safety_checks()}
    finally:
        await embedder._get_async_client().close()
        embedder.client.close()


server = FixtureHTTPServer(("127.0.0.1", 0), Handler)
allowed_port = server.server_port
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    with contextlib.redirect_stdout(sys.stderr):
        report = asyncio.run(asyncio.wait_for(experiment(f"http://127.0.0.1:{allowed_port}/v1"), timeout=30))
    assert counts["unexpected"] == 0 and denied == 0
    print(json.dumps({"schema": "new-money.embedding-coalescing-experiment.v1", "status": "PASS",
                      "realProvider": False, "productionEnabled": False, "deniedConnections": denied, **report}))
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)
